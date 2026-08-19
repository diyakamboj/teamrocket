# Basic, actionable alert rules — a first slice, not the full alerting
# strategy. Deliberately scoped to signals Azure Monitor can observe
# natively off resources this config already creates (App Service, its
# Service Plan, Application Insights), rather than the app's own
# backend/app/services/sre_events.py telemetry — that store lives in blob
# storage, not Azure Monitor, so it isn't something a `azurerm_monitor_*`
# alert can query. The in-app Ops dashboard (/ops in the frontend) is the
# real-time view for that; these are the "page someone" rules for signals
# Azure Monitor already tracks once deployed.
#
# Every rule fires and shows up in the Azure Portal regardless of
# var.alert_notification_email — that variable only controls whether the
# action group also sends an email. Set it (or add more receivers below)
# once the team has a monitoring inbox/Teams channel decided.

resource "azurerm_monitor_action_group" "main" {
  name                = "ag-${var.project_name}-${var.environment}"
  resource_group_name = data.azurerm_resource_group.main.name
  short_name          = substr(var.project_name, 0, 12)

  dynamic "email_receiver" {
    for_each = var.alert_notification_email != "" ? [var.alert_notification_email] : []
    content {
      name                    = "primary"
      email_address           = email_receiver.value
      use_common_alert_schema = true
    }
  }

  tags = var.tags
}

# Application health: server error rate. Mirrors backend/app/routes/ops.py's
# "backend" service status (>=10% error rate = critical), but as a
# platform-level metric so it still fires even if the app itself is too
# broken to serve /api/ops/overview.
resource "azurerm_monitor_metric_alert" "backend_http_5xx" {
  name                = "alert-${var.project_name}-backend-5xx-${var.environment}"
  resource_group_name = data.azurerm_resource_group.main.name
  scopes              = [azurerm_linux_web_app.backend.id]
  description         = "Backend App Service is returning HTTP 5xx responses. Check Application Insights failures/exceptions and the /ops dashboard's Application Health tab."
  severity            = 1
  frequency           = "PT5M"
  window_size         = "PT5M"

  criteria {
    metric_namespace = "Microsoft.Web/sites"
    metric_name      = "Http5xx"
    aggregation      = "Total"
    operator         = "GreaterThan"
    threshold        = 10
  }

  action {
    action_group_id = azurerm_monitor_action_group.main.id
  }

  tags = var.tags
}

# Performance: response time degradation.
resource "azurerm_monitor_metric_alert" "backend_response_time" {
  name                = "alert-${var.project_name}-backend-latency-${var.environment}"
  resource_group_name = data.azurerm_resource_group.main.name
  scopes              = [azurerm_linux_web_app.backend.id]
  description         = "Backend average response time is elevated. Check for a slow downstream dependency (Azure OpenAI, Document Intelligence) via the /ops dashboard's AI Services tab, or a resource-constrained App Service Plan."
  severity            = 2
  frequency           = "PT5M"
  window_size         = "PT15M"

  criteria {
    metric_namespace = "Microsoft.Web/sites"
    metric_name      = "ResponseTime"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 5 # seconds
  }

  action {
    action_group_id = azurerm_monitor_action_group.main.id
  }

  tags = var.tags
}

# Infrastructure: App Service Plan resource constraint.
resource "azurerm_monitor_metric_alert" "backend_cpu_high" {
  name                = "alert-${var.project_name}-backend-cpu-${var.environment}"
  resource_group_name = data.azurerm_resource_group.main.name
  scopes              = [azurerm_service_plan.backend.id]
  description         = "App Service Plan CPU is sustained high — the B1 tier has no autoscale headroom. Consider scaling up (var.app_service_sku) before this becomes request timeouts."
  severity            = 2
  frequency           = "PT5M"
  window_size         = "PT15M"

  criteria {
    metric_namespace = "Microsoft.Web/serverfarms"
    metric_name      = "CpuPercentage"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 85
  }

  action {
    action_group_id = azurerm_monitor_action_group.main.id
  }

  tags = var.tags
}

# Deployment/app-level failures once Application Insights is live (requires
# APPLICATIONINSIGHTS_CONNECTION_STRING to actually be wired up and the app
# emitting telemetry — see monitoring.tf / app_service.tf).
resource "azurerm_monitor_metric_alert" "app_insights_failed_requests" {
  name                = "alert-${var.project_name}-failed-requests-${var.environment}"
  resource_group_name = data.azurerm_resource_group.main.name
  scopes              = [azurerm_application_insights.main.id]
  description         = "Application Insights is reporting failed requests. Cross-reference with the /ops dashboard's Application Health and Diagnostics tabs for the specific failing endpoint."
  severity            = 1
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
