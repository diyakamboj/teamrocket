# Post-go-live observability. Nothing here existed before this file — the
# backend ran with zero telemetry beyond whatever App Service's own default
# console logs happened to capture.
#
# Ties directly into the app repo's PR #8 (Ops/SRE dashboard): its
# backend/app/config.py already reads an APPLICATIONINSIGHTS_CONNECTION_STRING
# setting and, if present, sends full telemetry to Azure Monitor instead of
# just the PR's built-in local/blob-backed fallback. That setting has been a
# no-op until now because nothing produced a value for it — this file is what
# produces it.

resource "azurerm_log_analytics_workspace" "main" {
  name                = "log-${var.project_name}-${var.environment}"
  resource_group_name = data.azurerm_resource_group.main.name
  location            = var.location
  sku                 = "PerGB2018"
  retention_in_days   = 30

  tags = var.tags
}

# Workspace-based (not classic) Application Insights — classic mode is
# deprecated by Microsoft and the provider steers toward workspace_id being
# set. Gives request rates, response times, exceptions, and dependency calls
# (OpenAI, AI Search, Blob, Document Intelligence) once the backend's SDK
# picks up the connection string below.
resource "azurerm_application_insights" "main" {
  name                = "appi-${var.project_name}-${var.environment}"
  resource_group_name = data.azurerm_resource_group.main.name
  location            = var.location
  workspace_id        = azurerm_log_analytics_workspace.main.id
  application_type    = "web"

  tags = var.tags
}

# APPLICATIONINSIGHTS-CONNECTION-STRING secret lives in keyvault.tf, grouped
# with the project's other Key Vault secrets rather than here.

# Platform-level logs (HTTP requests, console/app stdout+stderr, deploy
# platform events) — independent of Application Insights, and catches things
# app-level tracing wouldn't (e.g. a deploy failure before the app process
# ever starts). Sent to the same workspace so both are queryable together.
resource "azurerm_monitor_diagnostic_setting" "backend" {
  name                       = "diag-${var.project_name}-backend-${var.environment}"
  target_resource_id         = azurerm_linux_web_app.backend.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log {
    category = "AppServiceHTTPLogs"
  }
  enabled_log {
    category = "AppServiceConsoleLogs"
  }
  enabled_log {
    category = "AppServiceAppLogs"
  }
  enabled_log {
    category = "AppServicePlatformLogs"
  }

  enabled_metric {
    category = "AllMetrics"
  }
}

# -----------------------------------------------------------------------------
# Metric alerts. Metric names/units/aggregations below confirmed directly
# against Microsoft's supported-metrics reference before writing this (not
# assumed) — notably HttpResponseTime, not the deprecated AverageResponseTime
# or the guessable-but-wrong "ResponseTime", and CpuPercentage lives on the
# App Service *Plan* (Microsoft.Web/serverfarms), not the site itself
# (Microsoft.Web/sites has no CPU % metric outside Flex Consumption, which
# this isn't).
# -----------------------------------------------------------------------------

resource "azurerm_monitor_action_group" "main" {
  name                = "ag-${var.project_name}-${var.environment}"
  resource_group_name = data.azurerm_resource_group.main.name
  short_name          = "rsmiq-${var.environment}" # <=12 chars (provider-enforced)

  email_receiver {
    name                    = "primary"
    email_address           = var.alert_notification_email
    use_common_alert_schema = true
  }

  tags = var.tags
}

# Fires on real server-side failures — the "the app is actually broken"
# signal, as opposed to health_check_path below which only says an instance
# stopped responding.
resource "azurerm_monitor_metric_alert" "backend_5xx" {
  name                = "alert-${var.project_name}-backend-5xx-${var.environment}"
  resource_group_name = data.azurerm_resource_group.main.name
  scopes              = [azurerm_linux_web_app.backend.id]
  description         = "Backend returned HTTP 5xx responses."
  severity            = 2
  frequency           = "PT5M"
  window_size         = "PT5M"

  criteria {
    metric_namespace = "Microsoft.Web/sites"
    metric_name      = "Http5xx"
    aggregation      = "Total"
    operator         = "GreaterThan"
    threshold        = 5
  }

  action {
    action_group_id = azurerm_monitor_action_group.main.id
  }

  tags = var.tags
}

# Ties directly to health_check_path ("/health") in app_service.tf. On the
# current single-instance B1 plan this can't trigger the platform's
# auto-eviction (see app_service.tf's comment), so this alert is what
# actually notifies a human instead.
resource "azurerm_monitor_metric_alert" "backend_health" {
  name                = "alert-${var.project_name}-backend-health-${var.environment}"
  resource_group_name = data.azurerm_resource_group.main.name
  scopes              = [azurerm_linux_web_app.backend.id]
  description         = "Backend health check (GET /health) is failing."
  severity            = 1
  frequency           = "PT5M"
  window_size         = "PT5M"

  criteria {
    metric_namespace = "Microsoft.Web/sites"
    metric_name      = "HealthCheckStatus"
    aggregation      = "Average"
    operator         = "LessThan"
    threshold        = 100
  }

  action {
    action_group_id = azurerm_monitor_action_group.main.id
  }

  tags = var.tags
}

# Catches the app going slow before it goes fully down — e.g. an Azure
# OpenAI/AI Search/Document Intelligence call hanging. 10s over a 15-minute
# window, not 5, to avoid paging on a single slow burst.
resource "azurerm_monitor_metric_alert" "backend_response_time" {
  name                = "alert-${var.project_name}-backend-response-time-${var.environment}"
  resource_group_name = data.azurerm_resource_group.main.name
  scopes              = [azurerm_linux_web_app.backend.id]
  description         = "Backend average response time is elevated."
  severity            = 3
  frequency           = "PT5M"
  window_size         = "PT15M"

  criteria {
    metric_namespace = "Microsoft.Web/sites"
    metric_name      = "HttpResponseTime"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 10
  }

  action {
    action_group_id = azurerm_monitor_action_group.main.id
  }

  tags = var.tags
}

# Scoped to the Service Plan, not the site — CpuPercentage only exists on
# Microsoft.Web/serverfarms for a standard (non-Flex-Consumption) plan like
# this B1.
resource "azurerm_monitor_metric_alert" "backend_cpu" {
  name                = "alert-${var.project_name}-backend-cpu-${var.environment}"
  resource_group_name = data.azurerm_resource_group.main.name
  scopes              = [azurerm_service_plan.backend.id]
  description         = "App Service Plan CPU is sustained high — on a single-instance B1 plan this has nowhere to scale out to."
  severity            = 3
  frequency           = "PT5M"
  window_size         = "PT15M"

  criteria {
    metric_namespace = "Microsoft.Web/serverfarms"
    metric_name      = "CpuPercentage"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 80
  }

  action {
    action_group_id = azurerm_monitor_action_group.main.id
  }

  tags = var.tags
}

# Additive on top of the app-service-level alerts above: Application
# Insights' own "failed requests" metric captures SDK-tracked
# exceptions/failures at the application layer, not just HTTP 5xx at the
# platform layer — a request can fail in a way the app still returns 200
# for (e.g. a caught exception logged as a failure) that Http5xx above
# wouldn't see. Merged in from the Ops/SRE dashboard branch (PR #8); kept
# because it's a genuinely different signal, not a duplicate of the alerts
# above.
resource "azurerm_monitor_metric_alert" "app_insights_failed_requests" {
  name                = "alert-${var.project_name}-failed-requests-${var.environment}"
  resource_group_name = data.azurerm_resource_group.main.name
  scopes              = [azurerm_application_insights.main.id]
  description         = "Application Insights is reporting failed requests."
  severity            = 2
  frequency           = "PT5M"
  window_size         = "PT15M"

  criteria {
    metric_namespace = "microsoft.insights/components"
    metric_name      = "requests/failed"
    aggregation      = "Count"
    operator         = "GreaterThan"
    threshold        = 5
  }

  action {
    action_group_id = azurerm_monitor_action_group.main.id
  }

  tags = var.tags
}
