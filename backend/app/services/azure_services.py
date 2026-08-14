import hashlib
import json
import math
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
            self._client = BlobServiceClient.from_connection_string(
                settings.AZURE_STORAGE_CONNECTION_STRING
            )
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
        if configured:
            self._client = AzureOpenAI(
                api_key=settings.AZURE_OPENAI_API_KEY,
                api_version=settings.AZURE_OPENAI_API_VERSION,
                azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
            )
        # Chat completions stay gated by USE_MOCK_AZURE — the chat deployment
        # on this resource isn't confirmed working, so it must not go live as
        # a side effect of enabling something else on the same resource.
        self.mock = settings.USE_MOCK_AZURE or not configured
        # Embeddings are a separately-confirmed, independently-gated
        # deployment (mirrors AzureSearchService's decoupling from
        # USE_MOCK_AZURE) — one deployment being unready shouldn't block
        # the other from being used.
        self.embeddings_mock = (
            not configured or not settings.AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME
        )
        # semantic_skill_overlap is called once per candidate scored, and the
        # job's required/nice-to-have skills are identical on every one of
        # those calls — cache by exact text so ranking a pool doesn't
        # re-embed the same job requirements (or repeated common skills like
        # "Python") on every single candidate.
        self._embedding_cache: dict[str, list[float]] = {}

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
            return response.choices[0].message.content or ""
        except Exception as exc:
            logger.exception("Azure OpenAI call failed")
            raise AzureServiceError("Azure OpenAI request failed", {"reason": str(exc)}) from exc

    def embed_texts(self, texts: list[str]) -> Optional[list[list[float]]]:
        """Real embeddings for genuine semantic similarity. Returns None (the
        caller falls back to a keyword heuristic) in mock mode, when no
        embedding deployment is configured, or on any API failure — this is
        a quality upgrade, not something that should ever break scoring."""
        if self.embeddings_mock or not texts:
            return None
        assert self._client is not None

        to_fetch = [t for t in dict.fromkeys(texts) if t not in self._embedding_cache]
        if to_fetch:
            try:
                response = self._client.embeddings.create(
                    model=settings.AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME,
                    input=to_fetch,
                )
                for text, item in zip(to_fetch, response.data):
                    self._embedding_cache[text] = item.embedding
            except Exception as exc:
                logger.warning(
                    "Embedding request failed, falling back to keyword overlap: %s", exc
                )
                return None
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
        if "generate" in lower and ("matched skills" in lower or "format as json" in lower):
            return json.dumps(
                {
                    "matched_skills": [
                        {"skill": "Python", "source": "Experience"},
                        {"skill": "Azure", "source": "Skills"},
                    ],
                    "missing_skills": ["Kubernetes"],
                    "strengths": "Strong Python/API background with cloud exposure.",
                    "weaknesses": "Limited Kubernetes evidence.",
                    "transferable_skills": "Docker experience transfers well to container orchestration.",
                    "evidence": [
                        {
                            "skill_name": "Python",
                            "resume_text_snippet": "Built APIs using Python",
                            "source_section": "Experience",
                            "confidence_score": 0.9,
                        }
                    ],
                }
            )
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
            from azure.ai.documentintelligence import DocumentIntelligenceClient

            self._client = DocumentIntelligenceClient(
                endpoint=settings.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT,
                credential=AzureKeyCredential(settings.AZURE_DOCUMENT_INTELLIGENCE_KEY),
            )

    def extract_text(self, file_bytes: bytes, filename: str = "resume.pdf") -> str:
        if self.mock:
            # Prefer plain-text files in mock mode; otherwise return placeholder OCR text.
            if filename.lower().endswith(".txt"):
                return file_bytes.decode("utf-8", errors="ignore")
            return (
                "John Doe\nSoftware Engineer\nemail: john.doe@example.com\n"
                "Skills: Python, SQL, Azure, Docker, FastAPI\n"
                "Experience: Built REST APIs and cloud services for 4 years.\n"
                "Education: BSc Computer Science\n"
                "Projects: Resume ranking assistant using FastAPI"
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
            from azure.search.documents import SearchClient

            self._client = SearchClient(
                endpoint=settings.AZURE_SEARCH_ENDPOINT,
                index_name=settings.AZURE_SEARCH_INDEX_NAME,
                credential=AzureKeyCredential(settings.AZURE_SEARCH_ADMIN_KEY),
            )

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
