# -----------------------------------------------------------------------------
# Core
# -----------------------------------------------------------------------------

variable "resource_group_name" {
  description = "Existing resource group to provision into (owned resource; not created by this config)."
  type        = string
  default     = "TeamRocket"
}

variable "location" {
  description = "Azure region for all new resources. Matches the existing TeamRocket resource group."
  type        = string
  default     = "westus2"
}

variable "project_name" {
  description = "Short name used to build resource names. Keep lowercase, alphanumeric — several resource types (storage, key vault) have tight naming rules."
  type        = string
  default     = "resumeiq"
}

variable "environment" {
  description = "Deployment environment. Only 'dev' is provisioned today; extend with a second .tfvars file if a separate prod environment is needed later."
  type        = string
  default     = "dev"
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging, or prod."
  }
}

variable "tags" {
  description = "Tags applied to every resource this config manages."
  type        = map(string)
  default = {
    project = "resumeiq"
    team    = "teamrocket"
  }
}

# -----------------------------------------------------------------------------
# Shared AI credentials — values copied from the team's shared Group5-6
# vault (AI_Keys resource group), rather than read live via a data source
# (see data.tf for why: it let the GitHub Actions SP avoid needing any
# access to Group5-6 at all). No defaults — these aren't gracefully
# optional like smtp_username/github_token below; an empty value here
# breaks the app's core functionality (chat, search). Supply real values
# via a gitignored *.auto.tfvars file locally (read current values with
# `az keyvault secret show --vault-name Group5-6 --name <secret-name>`),
# or as CI secrets in GitHub Actions. Never commit real values.
# -----------------------------------------------------------------------------

variable "openai_api_key" {
  description = "Copied from Group5-6's 'Group5-6OpenAIAPIKey' secret."
  type        = string
  sensitive   = true
}

variable "openai_endpoint" {
  description = "Copied from Group5-6's 'Group5-6OpenAIEndPoint' secret."
  type        = string
  sensitive   = true
}

variable "embedding_api_key" {
  description = "Copied from Group5-6's 'Group5-6-text-embedding-3-small-APIKEY' secret."
  type        = string
  sensitive   = true
}

# No embedding_endpoint variable — the equivalent data source in the
# original data.tf was already dead code (defined, never referenced;
# keyvault.tf only ever stores an embedding *key* secret, reusing
# openai_endpoint's value for the endpoint side). Caught and dropped here
# rather than carried forward. See keyvault.tf's embedding_api_key comment.

variable "search_api_key" {
  description = "Copied from Group5-6's 'AISearch-APIKey' secret."
  type        = string
  sensitive   = true
}

variable "search_endpoint" {
  description = "Copied from Group5-6's 'AISearch-EndPoint' secret."
  type        = string
  sensitive   = true
}

# -----------------------------------------------------------------------------
# Model configuration
# -----------------------------------------------------------------------------

variable "openai_chat_deployment_name" {
  description = "Chat-capable deployment name on the shared sharedfoundry account. Only gpt-5 is live as of 2026-08-18 (see KNOWN-ISSUES.md R5) — gpt-4o/gpt-4o-mini/gpt-4.1 do not exist and won't be requested."
  type        = string
  default     = "gpt-5"
}

variable "openai_embedding_deployment_name" {
  description = "Embedding deployment name on the shared sharedfoundry account. Confirmed live."
  type        = string
  default     = "text-embedding-3-small"
}

variable "openai_api_version" {
  description = "Azure OpenAI API version backend's classic-deployment client calls with."
  type        = string
  default     = "2024-02-15-preview"
}

variable "search_index_name" {
  description = "Azure AI Search index name backend reads/writes candidate data to."
  type        = string
  default     = "candidates-index"
}

variable "blob_container_name" {
  description = "Blob container name backend stores resumes and application state in (phase-2 dropped Postgres in favor of blob-backed storage)."
  type        = string
  default     = "resumes"
}

# -----------------------------------------------------------------------------
# App Service
# -----------------------------------------------------------------------------

variable "app_service_sku" {
  description = "Linux App Service Plan SKU for the backend."
  type        = string
  default     = "B1"
}

# -----------------------------------------------------------------------------
# copilot/ integration — deferred (KNOWN-ISSUES.md #6). Backend degrades
# gracefully to its local agent when disabled, so this defaults off rather
# than pointing at a service that doesn't exist yet.
# -----------------------------------------------------------------------------

variable "chatbot_enabled" {
  description = "Whether backend should call the separate copilot/ (Chat With Your Data) service. False until that service's own infra strategy is decided and it's actually deployed."
  type        = bool
  default     = false
}

variable "chatbot_api_url" {
  description = "URL of the deployed copilot/ service, once it exists."
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# Secrets not yet available — placeholders so `plan`/`apply` don't require
# them up front. Supply real values via a gitignored *.auto.tfvars file
# locally, or as CI secrets in GitHub Actions. Never commit real values.
# -----------------------------------------------------------------------------

variable "smtp_username" {
  description = "Gmail address for outbound recruiter emails. Empty = SMTP disabled (backend logs emails instead of sending)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "smtp_password" {
  description = "Gmail App Password (NOT the account password) — generate at myaccount.google.com/apppasswords."
  type        = string
  default     = ""
  sensitive   = true
}

variable "github_token" {
  description = "Fine-grained GitHub PAT, public-repo read-only, no extra scopes — raises the anonymous api.github.com rate limit for candidate profile enrichment. See DOCUMENTATION.md #7 for generation steps."
  type        = string
  default     = ""
  sensitive   = true
}

# HACKERRANK_API_KEY intentionally has no variable here — confirmed dead
# code in backend/app/services/profile_enrichment_service.py (no live API
# call exists). See KNOWN-ISSUES.md #8. Add one only if that changes.
