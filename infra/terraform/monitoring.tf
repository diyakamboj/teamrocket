# Observability for the backend: Log Analytics workspace + workspace-based
# Application Insights (azurerm ~4.0 requires App Insights to be
# workspace-based — the older instrumentation-key-only mode is retired).
# No random suffix needed here, unlike storage.tf/keyvault.tf/
# document_intelligence.tf — Log Analytics/App Insights names don't have the
# same tight global-uniqueness rules those resource types do.

resource "azurerm_log_analytics_workspace" "main" {
  name                = "log-${var.project_name}-${var.environment}"
  resource_group_name = data.azurerm_resource_group.main.name
  location            = var.location
  sku                 = "PerGB2018"
  retention_in_days   = 30

  tags = var.tags
}

resource "azurerm_application_insights" "main" {
  name                = "appi-${var.project_name}-${var.environment}"
  resource_group_name = data.azurerm_resource_group.main.name
  location            = var.location
  application_type    = "web"
  workspace_id        = azurerm_log_analytics_workspace.main.id

  tags = var.tags
}
