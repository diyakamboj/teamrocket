import hashlib
import json
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


class AzureOpenAIService:
    def __init__(self) -> None:
        self.mock = (
            settings.USE_MOCK_AZURE
            or not settings.AZURE_OPENAI_API_KEY
            or not settings.AZURE_OPENAI_ENDPOINT
        )
        self._client: Optional[AzureOpenAI] = None
        if not self.mock:
            self._client = AzureOpenAI(
                api_key=settings.AZURE_OPENAI_API_KEY,
                api_version=settings.AZURE_OPENAI_API_VERSION,
                azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
            )

    def chat_json(
        self,
        prompt: str,
        *,
        system: str = "You are a helpful recruiting assistant. Return valid JSON only.",
        temperature: float = 0.3,
    ) -> dict[str, Any]:
        content = self.chat_text(prompt, system=system, temperature=temperature)
        return self._safe_json(content)

    def chat_text(
        self,
        prompt: str,
        *,
        system: str = "You are a helpful recruiting assistant.",
        temperature: float = 0.5,
        max_tokens: int = 1200,
        messages: Optional[list[dict[str, str]]] = None,
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
                model=settings.AZURE_OPENAI_DEPLOYMENT_NAME,
                messages=payload,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            return response.choices[0].message.content or ""
        except Exception as exc:
            logger.exception("Azure OpenAI call failed")
            raise AzureServiceError("Azure OpenAI request failed", {"reason": str(exc)}) from exc

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
        self.mock = (
            settings.USE_MOCK_AZURE
            or not settings.AZURE_SEARCH_ENDPOINT
            or not settings.AZURE_SEARCH_ADMIN_KEY
        )
        self._client = None
        if not self.mock:
            from azure.search.documents import SearchClient

            self._client = SearchClient(
                endpoint=settings.AZURE_SEARCH_ENDPOINT,
                index_name=settings.AZURE_SEARCH_INDEX_NAME,
                credential=AzureKeyCredential(settings.AZURE_SEARCH_ADMIN_KEY),
            )

    def semantic_skill_overlap(self, candidate_skills: list[str], required_skills: list[str]) -> float:
        """Approximate semantic overlap; falls back to keyword Jaccard in mock mode."""
        if not required_skills:
            return 100.0
        cand = {s.lower() for s in candidate_skills}
        req = {s.lower() for s in required_skills}
        overlap = len(cand & req)
        return round((overlap / len(req)) * 100, 2)

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
