---
title: Set up authentication
description: Sign users in to Chat with Your Data with Microsoft Entra ID through Azure Container Apps built-in authentication.
ms.date: 2026-07-03
ms.topic: how-to
---

[Back to *Chat with your data* README](../README.md)

![Supporting documentation](images/supportingDocuments.png)

# Set Up Authentication in Azure Container Apps

This document provides step-by-step instructions to enable Microsoft Entra ID authentication on the frontend Container App (`ca-frontend-<suffix>`), the public web UI.

## Prerequisites

- Access to **Microsoft Entra ID**
- Necessary permissions to create and manage **App Registrations**

## Step 1: Add Authentication in the frontend Container App

1. Open the frontend Container App (`ca-frontend-<suffix>`) and click on `Authentication` from the left menu.

  ![Authentication](images/AppAuthentication.png)

2. Click on `+ Add identity provider` to see a list of identity providers.

  ![Authentication Identity](images/AppAuthenticationIdentity.png)

3. Click on `Identity Provider` dropdown to see a list of identity providers.

  ![Add Provider](images/AppAuthIdentityProvider.png)

4. Select the first option `Microsoft Entra Id` from the drop-down list and select `client secret expiration` under App registration.
> NOTE: If `Create new app registration` is disabled, then go to [Create new app registration](create_new_app_registration.md) and come back to this step to complete the app authentication.

 ![Add Provider](images/AppAuthIdentityProviderAdd.png)

5. Accept the default values and click on `Add` button to go back to the previous page with the identity provider added.

 ![Add Provider](images/AppAuthIdentityProviderAdded.png)

6. You have successfully added app authentication, and now required to log in to access the application.