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

variable "terraform_operator_principal_id" {
  description = "Object ID of the identity that holds Key Vault Secrets Officer on the project vault (see keyvault.tf's terraform_secrets_officer) — i.e. whichever identity is the routine Terraform operator. Deliberately fixed, not looked up dynamically — see that resource's comment for why. Defaults to the github-teamrocket-terraform GitHub Actions service principal's object id (not its app/client id — role assignments need the SP object id)."
  type        = string
  default     = "b3878a10-73b9-4ef1-8b6d-954f47ced055"
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

variable "embedding_endpoint" {
  description = "Copied from Group5-6's 'Group5-6-text-embedding-3-small-EndPoint' secret. RE-ADDED 2026-08-19: an earlier version of this comment called this dead code, reasoning the original (pre-refactor) data source was never referenced anywhere. That was true of the data source, but wrong about the underlying need — backend/app/services/azure_services.py's embedding client reads AZURE_OPENAI_EMBEDDING_API_KEY and AZURE_OPENAI_EMBEDDING_ENDPOINT as two distinct settings, with no fallback to the main AZURE_OPENAI_* ones. app_service.tf never wired either into app_settings, so this was a real, live gap, not dead code — confirmed directly against the backend source before re-adding this."
  type        = string
  sensitive   = true
}

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

variable "google_client_id" {
  description = <<-EOT
    "Sign in with Google" OAuth 2.0 Web application Client ID, from
    console.cloud.google.com/apis/credentials. Not a secret — it is public
    in the frontend bundle regardless — but must be the *same* value the
    frontend build embeds as VITE_GOOGLE_CLIENT_ID (azure-pipelines.yml's
    googleClientId variable), since an ID token is only valid for the
    audience it was issued for. Empty disables the backend endpoint.
  EOT
  type        = string
  default     = "704845703885-s983jor0pui2juhfgg1e6d3m2pt4st2u.apps.googleusercontent.com"
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

# -----------------------------------------------------------------------------
# Alerting (monitoring.tf)
# -----------------------------------------------------------------------------

variable "alert_notification_email" {
  description = "Email address the action group in monitoring.tf notifies when a metric alert fires. Not a secret, but personal/team contact info — kept out of tracked .tfvars the same way smtp_username etc. are; supply via a gitignored *.auto.tfvars file. No default: alerts with nowhere to send are worse than an apply that fails loudly and asks for one."
  type        = string
  sensitive   = true
}

# HACKERRANK_API_KEY intentionally has no variable here — confirmed dead
# code in backend/app/services/profile_enrichment_service.py (no live API
# call exists). See KNOWN-ISSUES.md #8. Add one only if that changes.
