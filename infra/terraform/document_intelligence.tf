# Net-new resource — nothing in the shared Group5-6 vault covers Document
# Intelligence (KNOWN-ISSUES.md #3). Confirmed OK to provision fresh.

# Random suffix so a destroy/recreate cycle never collides with a name
# stuck in Azure's soft-delete bin (this identity has no subscription-level
# purge rights — see KNOWN-ISSUES.md #14 — so an unsuffixed name that gets
# soft-deleted once stays unusable indefinitely).
resource "random_string" "docintel_suffix" {
  length  = 4
  special = false
  upper   = false
}

resource "azurerm_cognitive_account" "document_intelligence" {
  name                = "cog-${var.project_name}-docintel-${var.environment}-${random_string.docintel_suffix.result}"
  resource_group_name = data.azurerm_resource_group.main.name
  location            = var.location

  kind     = "FormRecognizer" # provider's kind value for Document Intelligence
  sku_name = "S0"

  custom_subdomain_name         = "${var.project_name}-docintel-${var.environment}-${random_string.docintel_suffix.result}"
  public_network_access_enabled = true # backend calls this from App Service, key-based

  tags = var.tags
}
