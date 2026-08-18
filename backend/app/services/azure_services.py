import hashlib
import json
import math
import re
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from azure.core.credentials import AzureKeyCredential
from azure.storage.blob import BlobServiceClient, ContentSettings
from openai import AzureOpenAI

from app.config import settings
from app.utils.error_handlers import AzureServiceError
from app.utils.logger import get_logger

logger = get_logger(__name__)


class AzureBlobService:
    def __init__(self) -> None:
        self.container = settings.AZURE_BLOB_CONTAINER_NAME
        self._client: Optional[BlobServiceClient] = None
        self.mock = settings.USE_MOCK_AZURE or not settings.AZURE_STORAGE_CONNECTION_STRING
        if not self.mock:
            # This runs at import (module-level singleton), so a malformed
            # connection string used to abort the whole process before the app
            # could serve a single request. Fall back to local-disk storage and
            # say so loudly instead.
            try:
                self._client = BlobServiceClient.from_connection_string(
                    settings.AZURE_STORAGE_CONNECTION_STRING
                )
            except Exception as exc:
                logger.error(
                    "Azure Blob Storage credentials are invalid (%s) — falling back to local "
                    "disk at %s. AZURE_STORAGE_CONNECTION_STRING must be the full connection "
                    "string (DefaultEndpointsProtocol=...;AccountName=...;AccountKey=...), "
                    "not just the account key.",
                    exc,
                    settings.UPLOAD_DIR,
                )
                self._client = None
                self.mock = True
            else:
                try:
                    self._client.create_container(self.container)
                except Exception:
                    pass

    def upload_bytes(self, data: bytes, filename: str, content_type: str = "application/pdf") -> str:
        blob_name = f"resumes/{uuid.uuid4()}/{filename}"
        if self.mock:
            local_dir = Path(settings.UPLOAD_DIR) / "blobs"
            local_dir.mkdir(parents=True, exist_ok=True)
            path = local_dir / blob_name.replace("/", "_")
            path.write_bytes(data)
            logger.info("Mock blob upload: %s", path)
            return str(path)

        assert self._client is not None
        blob = self._client.get_blob_client(container=self.container, blob=blob_name)
        blob.upload_blob(
            data,
            overwrite=True,
            content_settings=ContentSettings(content_type=content_type),
        )
        return blob_name

    def download_bytes(self, blob_path: str) -> bytes:
        if self.mock or Path(blob_path).exists():
            path = Path(blob_path)
            if not path.exists():
                raise AzureServiceError("Blob not found locally", {"path": blob_path})
            return path.read_bytes()

        assert self._client is not None
        blob = self._client.get_blob_client(container=self.container, blob=blob_path)
        return blob.download_blob().readall()


class JsonBlobStore:
    """Generic JSON-document store layered on top of AzureBlobService.

    This is the persistence primitive that replaces the SQLAlchemy/SQLite
    layer: every structured entity in the app (candidates, jobs,
    evaluations, evidence, audit logs, ...) is written as one JSON document
    per blob key, under a shared `documents/` prefix in the same blob
    container used for raw resume bytes.

    Mock mode (USE_MOCK_AZURE) writes real nested directories under
    `UPLOAD_DIR/documents/...` so prefix listing works via `Path.rglob`.
    Real mode uses the Azure Blob Storage container directly, listing blobs
    by name prefix.
    """

    def __init__(self, blob_service: AzureBlobService, prefix: str = "documents") -> None:
        self._blob_service = blob_service
        self.prefix = prefix.strip("/")

    def _local_root(self) -> Path:
        root = Path(settings.UPLOAD_DIR) / self.prefix
        root.mkdir(parents=True, exist_ok=True)
        return root

    def _local_path(self, key: str) -> Path:
        return self._local_root() / key

    def _blob_name(self, key: str) -> str:
        return f"{self.prefix}/{key}"

    def put(self, key: str, doc: dict) -> None:
        data = json.dumps(doc, default=str).encode("utf-8")
        if self._blob_service.mock:
            path = self._local_path(key)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            return

        client = self._blob_service._client
        assert client is not None
        blob = client.get_blob_client(container=self._blob_service.container, blob=self._blob_name(key))
        blob.upload_blob(
            data,
            overwrite=True,
            content_settings=ContentSettings(content_type="application/json"),
        )

    def get(self, key: str) -> Optional[dict]:
        if self._blob_service.mock:
            path = self._local_path(key)
            if not path.exists():
                return None
            return json.loads(path.read_text(encoding="utf-8"))

        client = self._blob_service._client
        assert client is not None
        blob = client.get_blob_client(container=self._blob_service.container, blob=self._blob_name(key))
        try:
            data = blob.download_blob().readall()
        except Exception:
            return None
        return json.loads(data.decode("utf-8"))

    def delete(self, key: str) -> None:
        if self._blob_service.mock:
            path = self._local_path(key)
            if path.exists():
                path.unlink()
            return

        client = self._blob_service._client
        assert client is not None
        blob = client.get_blob_client(container=self._blob_service.container, blob=self._blob_name(key))
        try:
            blob.delete_blob()
        except Exception:
            pass

    def exists(self, key: str) -> bool:
        if self._blob_service.mock:
            return self._local_path(key).exists()

        client = self._blob_service._client
        assert client is not None
        blob = client.get_blob_client(container=self._blob_service.container, blob=self._blob_name(key))
        return bool(blob.exists())

    def list_prefix(self, prefix: str) -> list[str]:
        """List document keys (relative to `documents/`) under `prefix`, sorted ascending."""
        prefix = prefix.strip("/")
        if self._blob_service.mock:
            root = self._local_root()
            base = root / prefix if prefix else root
            if not base.exists():
                return []
            keys = [
                str(path.relative_to(root))
                for path in base.rglob("*.json")
                if path.is_file()
            ]
            return sorted(keys)

        client = self._blob_service._client
        assert client is not None
        container_client = client.get_container_client(self._blob_service.container)
        full_prefix = f"{self.prefix}/{prefix}" if prefix else f"{self.prefix}/"
        keys = [
            blob.name[len(self.prefix) + 1 :]
            for blob in container_client.list_blobs(name_starts_with=full_prefix)
        ]
        return sorted(keys)


class AzureOpenAIService:
    def __init__(self) -> None:
        configured = bool(settings.AZURE_OPENAI_API_KEY and settings.AZURE_OPENAI_ENDPOINT)
        self._client: Optional[AzureOpenAI] = None
        self._embedding_client: Optional[AzureOpenAI] = None

        if configured:
            self._client = AzureOpenAI(
                api_key=settings.AZURE_OPENAI_API_KEY,
                api_version=settings.AZURE_OPENAI_API_VERSION,
                azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
                timeout=30.0,
                max_retries=settings.AZURE_OPENAI_MAX_RETRIES,
            )

        emb_configured = bool(settings.AZURE_OPENAI_EMBEDDING_API_KEY and settings.AZURE_OPENAI_EMBEDDING_ENDPOINT)
        if emb_configured:
            self._embedding_client = AzureOpenAI(
                api_key=settings.AZURE_OPENAI_EMBEDDING_API_KEY,
                api_version=settings.AZURE_OPENAI_API_VERSION,
                azure_endpoint=settings.AZURE_OPENAI_EMBEDDING_ENDPOINT,
                timeout=30.0,
                max_retries=settings.AZURE_OPENAI_MAX_RETRIES,
            )
        else:
            self._embedding_client = self._client

        self.mock = settings.USE_MOCK_AZURE or not configured
        self.embeddings_mock = (
            (not configured and not emb_configured) or not settings.AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME
        )
        self._embedding_cache: dict[str, list[float]] = {}

        # Circuit breaker. Scoring loops call this service once per candidate,
        # so a misconfigured or down endpoint otherwise multiplies its failure
        # latency by the pool size — 200 candidates x retry backoff turned the
        # ranking endpoint into a >10 minute hang. After
        # OPENAI_FAILURE_THRESHOLD consecutive failures the breaker opens and
        # calls fail instantly (falling straight through to the deterministic
        # path) until OPENAI_BREAKER_COOLDOWN_SECONDS has passed, then one
        # request is allowed through to test recovery.
        self._consecutive_failures = 0
        self._breaker_opened_at: float | None = None


    def chat_json(
        self,
        prompt: str,
        *,
        system: str = "You are a helpful recruiting assistant. Return valid JSON only.",
        temperature: float = 0.3,
        deployment: Optional[str] = None,
    ) -> dict[str, Any]:
        content = self.chat_text(prompt, system=system, temperature=temperature, deployment=deployment)
        return self._safe_json(content)

    def chat_json_or_empty(
        self,
        prompt: str,
        *,
        system: str = "You are a helpful recruiting assistant. Return valid JSON only.",
        temperature: float = 0.3,
        deployment: Optional[str] = None,
    ) -> dict[str, Any]:
        """`chat_json`, but returns {} instead of raising when Azure is
        unreachable or errors.

        Every caller of this already treats a missing key as "fall back to the
        deterministic result" (keyword scoring, heuristic JD parsing, and so
        on). Letting the exception escape instead turns a transient Azure
        outage into a 500 on core screening endpoints, which is exactly the
        graceful-degradation guarantee the AI seams are supposed to keep. The
        failure is logged rather than swallowed silently.
        """
        try:
            return self.chat_json(
                prompt, system=system, temperature=temperature, deployment=deployment
            )
        except AzureServiceError as exc:
            logger.warning(
                "Azure OpenAI unavailable, falling back to deterministic logic: %s", exc
            )
            return {}

    def chat_text(
        self,
        prompt: str,
        *,
        system: str = "You are a helpful recruiting assistant.",
        temperature: float = 0.5,
        max_tokens: int = 1200,
        messages: Optional[list[dict[str, str]]] = None,
        deployment: Optional[str] = None,
    ) -> str:
        if self.mock:
            return self._mock_response(prompt)

        if self._breaker_is_open():
            raise AzureServiceError(
                "Azure OpenAI unavailable (circuit breaker open)",
                {"consecutive_failures": self._consecutive_failures},
            )

        assert self._client is not None
        payload = messages or [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ]
        try:
            response = self._client.chat.completions.create(
                model=deployment or settings.AZURE_OPENAI_DEPLOYMENT_NAME,
                messages=payload,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        except Exception as exc:
            self._record_failure()
            logger.warning("Azure OpenAI call failed: %s", exc)
            raise AzureServiceError("Azure OpenAI request failed", {"reason": str(exc)}) from exc

        self._record_success()
        return response.choices[0].message.content or ""

    # ---------- circuit breaker ----------

    def _breaker_is_open(self) -> bool:
        if self._breaker_opened_at is None:
            return False
        elapsed = time.monotonic() - self._breaker_opened_at
        if elapsed < settings.AZURE_OPENAI_BREAKER_COOLDOWN_SECONDS:
            return True
        # Cooldown elapsed — let one request through to probe for recovery.
        self._breaker_opened_at = None
        self._consecutive_failures = settings.AZURE_OPENAI_FAILURE_THRESHOLD - 1
        return False

    def _record_failure(self) -> None:
        self._consecutive_failures += 1
        if (
            self._consecutive_failures >= settings.AZURE_OPENAI_FAILURE_THRESHOLD
            and self._breaker_opened_at is None
        ):
            self._breaker_opened_at = time.monotonic()
            logger.error(
                "Azure OpenAI failed %d times in a row — skipping calls for %.0fs and using "
                "deterministic fallbacks. Check AZURE_OPENAI_ENDPOINT / credentials.",
                self._consecutive_failures,
                settings.AZURE_OPENAI_BREAKER_COOLDOWN_SECONDS,
            )

    def _record_success(self) -> None:
        if self._breaker_opened_at is not None or self._consecutive_failures:
            logger.info("Azure OpenAI recovered")
        self._consecutive_failures = 0
        self._breaker_opened_at = None

    def embed_texts(self, texts: list[str]) -> Optional[list[list[float]]]:
        """Real embeddings for genuine semantic similarity. Returns None (the
        caller falls back to a keyword heuristic) in mock mode, when no
        embedding deployment is configured, or on any API failure — this is
        a quality upgrade, not something that should ever break scoring."""
        if self.embeddings_mock or not texts or self._embedding_client is None:
            return None

        to_fetch = [t for t in dict.fromkeys(texts) if t not in self._embedding_cache]
        if to_fetch:
            # Embeddings share the endpoint, so they share the breaker — one
            # unreachable resource shouldn't be re-dialled once per candidate.
            if self._breaker_is_open():
                return None
            try:
                response = self._embedding_client.embeddings.create(
                    model=settings.AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME,
                    input=to_fetch,
                )

                for text, item in zip(to_fetch, response.data):
                    self._embedding_cache[text] = item.embedding
            except Exception as exc:
                self._record_failure()
                logger.warning(
                    "Embedding request failed, falling back to keyword overlap: %s", exc
                )
                return None
            self._record_success()
        return [self._embedding_cache[t] for t in texts]

    def _safe_json(self, content: str) -> dict[str, Any]:
        content = content.strip()
        if content.startswith("```"):
            content = content.strip("`")
            if content.startswith("json"):
                content = content[4:].strip()
        try:
            data = json.loads(content)
            if isinstance(data, dict):
                return data
            return {"data": data}
        except json.JSONDecodeError:
            start = content.find("{")
            end = content.rfind("}")
            if start >= 0 and end > start:
                try:
                    return json.loads(content[start : end + 1])
                except json.JSONDecodeError:
                    pass
            logger.warning("Failed to parse JSON from model response")
            return {"raw": content}

    @staticmethod
    def _mock_evaluation_narrative(prompt: str) -> dict[str, Any]:
        """Offline stand-in for the evaluation-narrative LLM call.

        Deliberately omits `matched_skills`/`missing_skills` so
        CandidateMatcher's deterministic fallback derives them from this
        candidate's actual skills against this job's actual requirements —
        a fixed skill list here would be wrong for every candidate. The
        narrative is phrased off the real per-dimension scores parsed back
        out of the prompt, so it tracks the candidate being scored.
        """
        scores: dict[str, float] = {}
        for line in prompt.splitlines():
            line = line.strip()
            if not line.startswith("- ") or ":" not in line or "/100" not in line:
                continue
            label, _, value = line[2:].partition(":")
            try:
                scores[label.strip()] = float(value.strip().split("/")[0])
            except ValueError:
                continue

        def band(name: str) -> str:
            value = scores.get(name)
            if value is None:
                return "not evaluated"
            if value >= 80:
                return "strong"
            if value >= 60:
                return "solid"
            if value >= 40:
                return "partial"
            return "limited"

        strong = [name for name, value in scores.items() if value >= 70]
        weak = [name for name, value in scores.items() if value < 50]

        return {
            "strengths": (
                "Strongest evidence in " + ", ".join(strong).lower() + "."
                if strong
                else "No dimension scored above the strong-evidence threshold."
            ),
            # Empty rather than a "nothing found" sentence: callers render this
            # as a gap list, where a reassuring sentence would read as a gap.
            "weaknesses": ("Thin evidence for " + ", ".join(weak).lower() + "." if weak else ""),
            "transferable_skills": (
                f"Skill match is {band('Skill Match')} and role alignment is "
                f"{band('Role Alignment')}; adjacent experience should be probed in interview."
            ),
            "technical_skills_explanation": f"Technical skill evidence is {band('Technical Skills')}.",
            "communication_explanation": f"Communication evidence is {band('Communication')}.",
            "role_alignment_explanation": f"Role alignment is {band('Role Alignment')}.",
            "overall_fit_explanation": f"Overall fit is {band('Overall Fit')} against this job's requirements.",
            "dimensions": {
                "technical_skills_explanation": f"Technical skill evidence is {band('Technical Skills')}.",
                "communication_explanation": f"Communication evidence is {band('Communication')}.",
                "role_alignment_explanation": f"Role alignment is {band('Role Alignment')}.",
                "overall_fit_explanation": f"Overall fit is {band('Overall Fit')}.",
            },
        }

    def _mock_response(self, prompt: str) -> str:
        lower = prompt.lower()
        if "parse this resume" in lower:
            digest = hashlib.md5(prompt.encode()).hexdigest()[:6]
            return json.dumps(
                {
                    "contact_info": {
                        "name": f"Candidate {digest.upper()}",
                        "email": f"candidate.{digest}@example.com",
                        "phone": "+1-555-0100",
                    },
                    "skills": ["Python", "SQL", "Azure", "Docker", "FastAPI"],
                    "work_experience": [
                        {
                            "company": "Northwind Labs",
                            "title": "Software Engineer",
                            "duration": "2021-2024",
                            "years": 3,
                            "description": "Built APIs and data pipelines using Python and Azure.",
                        }
                    ],
                    "education": [
                        {
                            "school": "State University",
                            "degree": "BSc",
                            "field": "Computer Science",
                        }
                    ],
                    "certifications": ["AZ-900"],
                    "projects": [
                        {
                            "name": "Resume Matcher",
                            "description": "AI ranking prototype",
                            "technologies": ["Python", "FastAPI"],
                        }
                    ],
                }
            )
        if "extract" in lower and "job" in lower:
            return json.dumps(
                {
                    "required_skills": ["Python", "SQL", "Azure", "Docker"],
                    "nice_to_have_skills": ["Kubernetes", "Terraform"],
                    "required_experience_years": 3,
                    "education_requirements": "Bachelor's in Computer Science or equivalent",
                    "summary": "Backend-focused role requiring cloud and API experience.",
                }
            )
        if "generate" in lower and (
            "matched skills" in lower or "matched_skills" in lower or "format as json" in lower
        ):
            return json.dumps(self._mock_evaluation_narrative(prompt))
        if "semantic fit review" in lower:
            return json.dumps(
                {
                    "semantic_score": 78,
                    "rationale": (
                        "Resume shows hands-on delivery in the required stack with production "
                        "ownership; some required keywords appear as adjacent tools rather than "
                        "exact terms, which a literal keyword scan would miss."
                    ),
                    "equivalent_terms": [
                        {"resume_term": "FastAPI", "jd_keyword": "Python"},
                        {"resume_term": "Azure Blob Storage", "jd_keyword": "Azure"},
                    ],
                }
            )
        if "compare these" in lower:
            return (
                "Candidate A shows stronger cloud depth; Candidate B has broader product experience. "
                "Recommend interviewing A first for backend cloud roles."
            )
        return (
            "Based on the ranked candidate pool, prioritize candidates with strong Python and Azure "
            "evidence, then validate production ownership in interviews."
        )


class AzureDocumentIntelligenceService:
    def __init__(self) -> None:
        self.mock = (
            settings.USE_MOCK_AZURE
            or not settings.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT
            or not settings.AZURE_DOCUMENT_INTELLIGENCE_KEY
        )
        self._client = None
        if not self.mock:
            try:
                from azure.ai.documentintelligence import DocumentIntelligenceClient

                self._client = DocumentIntelligenceClient(
                    endpoint=settings.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT,
                    credential=AzureKeyCredential(settings.AZURE_DOCUMENT_INTELLIGENCE_KEY),
                )
            except Exception as exc:
                logger.error(
                    "Azure Document Intelligence unavailable (%s) — falling back to local "
                    "PDF text extraction.",
                    exc,
                )
                self._client = None
                self.mock = True

    def _extract_pdf_or_docx_fallback(self, file_bytes: bytes, filename: str) -> str:
        ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
        if ext == "pdf":
            try:
                import io
                from pypdf import PdfReader
                reader = PdfReader(io.BytesIO(file_bytes))
                text_parts = [page.extract_text() for page in reader.pages if page.extract_text()]
                if text_parts:
                    return "\n".join(text_parts)
            except Exception:
                pass
            try:
                text = file_bytes.decode("latin1", errors="ignore")
                matches = re.findall(r"\(([^()]{3,})\)", text)
                if len(matches) > 5:
                    return "\n".join(matches)
            except Exception:
                pass
        return ""

    def extract_text(self, file_bytes: bytes, filename: str = "resume.pdf") -> str:
        if self.mock:
            if filename.lower().endswith(".txt"):
                return file_bytes.decode("utf-8", errors="ignore")
            extracted = self._extract_pdf_or_docx_fallback(file_bytes, filename)
            if extracted and len(extracted.strip()) > 30:
                return extracted
            clean_name = filename.replace("_", " ").replace("-", " ").rsplit(".", 1)[0].title()
            clean_email = re.sub(r"[^a-zA-Z0-9]", "", filename.lower().rsplit(".", 1)[0]) or "candidate"
            return (
                f"{clean_name}\nSoftware Engineer\nemail: {clean_email}@example.com\n"
                "Skills: Python, React, Azure, Docker, FastAPI, Kubernetes\n"
                "Experience: Senior Software Engineer with 5 years experience building cloud services.\n"
                "Education: Bachelor of Science in Computer Science\n"
                "Projects: Distributed systems and microservices platform"
            )

        assert self._client is not None

        try:
            poller = self._client.begin_analyze_document(
                "prebuilt-read",
                body=file_bytes,
                content_type="application/octet-stream",
            )
            result = poller.result()
            return result.content or ""
        except Exception as exc:
            logger.exception("Document Intelligence failed")
            raise AzureServiceError(
                "Document Intelligence extraction failed", {"reason": str(exc)}
            ) from exc


class AzureSearchService:
    def __init__(self) -> None:
        # Deliberately independent of USE_MOCK_AZURE: Search has its own
        # dedicated credentials and can go live without touching the mock
        # status of OpenAI/Blob/Document Intelligence, which may not have a
        # working deployment yet.
        self.mock = not settings.AZURE_SEARCH_ENDPOINT or not settings.AZURE_SEARCH_ADMIN_KEY
        self._client = None
        if not self.mock:
            try:
                from azure.search.documents import SearchClient

                self._client = SearchClient(
                    endpoint=settings.AZURE_SEARCH_ENDPOINT,
                    index_name=settings.AZURE_SEARCH_INDEX_NAME,
                    credential=AzureKeyCredential(settings.AZURE_SEARCH_ADMIN_KEY),
                )
            except Exception as exc:
                logger.error(
                    "Azure AI Search unavailable (%s) — falling back to keyword overlap.", exc
                )
                self._client = None
                self.mock = True

    def semantic_skill_overlap(self, candidate_skills: list[str], required_skills: list[str]) -> float:
        """Real embedding-based semantic overlap when an embedding deployment
        is configured; falls back to literal keyword overlap otherwise (mock
        mode, no deployment, or an API failure)."""
        if not required_skills:
            return 100.0
        if not candidate_skills:
            return 0.0

        embedded = self._embedding_overlap(candidate_skills, required_skills)
        if embedded is not None:
            return embedded

        cand = {s.lower() for s in candidate_skills}
        req = {s.lower() for s in required_skills}
        overlap = len(cand & req)
        return round((overlap / len(req)) * 100, 2)

    def _embedding_overlap(
        self, candidate_skills: list[str], required_skills: list[str]
    ) -> Optional[float]:
        vectors = openai_service.embed_texts([*candidate_skills, *required_skills])
        if not vectors:
            return None
        cand_vecs = vectors[: len(candidate_skills)]
        req_vecs = vectors[len(candidate_skills) :]
        if not cand_vecs or not req_vecs:
            return None

        # For each required skill, take the candidate's best-matching skill
        # by cosine similarity; overall score is the mean of those best
        # matches, rescaled from an empirically-observed band rather than
        # the full [-1, 1] range. text-embedding-3-small cosine similarity
        # for short skill phrases (measured against this deployment):
        # unrelated pairs (e.g. "Python"/"bricklaying") land ~0.11-0.14,
        # genuinely related-but-different skills (e.g. "Node.js"/
        # "JavaScript", "AWS"/"Azure") land ~0.50-0.71, identical = 1.0.
        best_matches = [
            max(self._cosine(req_vec, cand_vec) for cand_vec in cand_vecs) for req_vec in req_vecs
        ]
        mean_best = sum(best_matches) / len(best_matches)
        floor, ceiling = 0.15, 0.65
        return round(max(0.0, min(100.0, (mean_best - floor) / (ceiling - floor) * 100)), 2)

    @staticmethod
    def _cosine(a: list[float], b: list[float]) -> float:
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = math.sqrt(sum(x * x for x in a))
        norm_b = math.sqrt(sum(y * y for y in b))
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)

    def upsert_candidate(self, candidate: dict[str, Any]) -> None:
        if self.mock or not self._client:
            return
        try:
            self._client.upload_documents(documents=[{**candidate, "@search.action": "mergeOrUpload"}])
        except Exception as exc:
            logger.warning("Azure Search upsert failed: %s", exc)


blob_service = AzureBlobService()
openai_service = AzureOpenAIService()
doc_intelligence_service = AzureDocumentIntelligenceService()
search_service = AzureSearchService()
document_store = JsonBlobStore(blob_service)
