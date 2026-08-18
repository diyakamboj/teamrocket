# Storage account name must be globally unique, lowercase alphanumeric,
# <=24 chars — hence the random suffix rather than relying on project name alone.
resource "random_string" "storage_suffix" {
  length  = 6
  special = false
  upper   = false
}

# Single storage account serves two purposes:
#   1. Blob backend for the resume-screening app (phase-2 dropped Postgres
#      entirely in favor of blob-backed state — see KNOWN-ISSUES.md R4).
#   2. Static website hosting for the frontend SPA (Vite build output).
resource "azurerm_storage_account" "main" {
  name                = "st${var.project_name}${var.environment}${random_string.storage_suffix.result}"
  resource_group_name = data.azurerm_resource_group.main.name
  location            = var.location

  account_tier             = "Standard"
  account_replication_type = "LRS" # dev-tier; revisit for prod (GRS/ZRS)
  account_kind             = "StorageV2"
  min_tls_version          = "TLS1_2"

  # backend/app/services/azure_services.py authenticates with a connection
  # string (AzureKeyCredential pattern throughout, not managed identity) —
  # shared keys must stay enabled for that to work.
  shared_access_key_enabled = true

  tags = var.tags
}

resource "azurerm_storage_account_static_website" "frontend" {
  storage_account_id = azurerm_storage_account.main.id
  index_document     = "index.html"
  error_404_document = "index.html" # SPA client-side routing fallback
}

# Private container for uploaded resumes + application state.
resource "azurerm_storage_container" "resumes" {
  name                  = var.blob_container_name
  storage_account_id    = azurerm_storage_account.main.id
  container_access_type = "private"
}
