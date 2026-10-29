# Deploy your Capstone shop to Azure

This guide takes your finished grocery shop (database, API and front end) from your laptop to **your own Azure account**, deployed by your own GitHub Actions pipeline. It assumes you have never deployed anything before. Follow it in order.

While you build, nothing here is needed: your front end runs on your laptop against Gurukul's shop server with your shop key, and Gurukul's test kit runs in your pipeline. You deploy in the **DevOps** stage, and go live from that deployment in the **Release** stage.

> **Prices and free offers: as of October 2026 — check the current offer.** Every number below was read on Microsoft's own pages on 2026-10-29. Offers change. If an official page says something different when you read it, the official page wins. Links are at the end.

What you will end up with, all in one resource group called `rg-grocery-prod`:

| Tier | Azure service | What it costs you (as of October 2026) |
|---|---|---|
| Database | Azure SQL Database, **free offer** (serverless) | Free: 100,000 vCore seconds of compute, 32 GB of data and 32 GB of backup storage per database each month, for the life of the subscription. |
| API | App Service, **Free (F1)** plan, running your API's container image | Free: 60 CPU minutes a day, 1 GB of memory, no Always On, an `azurewebsites.net` address only. |
| Front end | Static Web Apps, **Free** plan | Free: 100 GB of bandwidth a month per subscription, up to 10 apps per subscription. |
| Secrets | Key Vault (Standard) | Charged per operation; there is no free allowance. A small shop reads a handful of secrets at start-up. See the Key Vault pricing page. |
| Logs (optional) | Application Insights | Charged by data ingested. If you add it, set a daily cap. |

Your API image is kept in the **public GitHub Container Registry package** your pipeline already builds and scans (DevOps stage, R8), so you need no paid container registry.

---

## 1. Sign up

Pick one.

### Azure for Students (recommended if you can)

- **Who:** aged 18 or over, a full-time student at an accredited, degree-granting two- or four-year institution, verified with your **school email**. One account per person.
- **What you get:** 100 US dollars of credit to use within 12 months, plus free amounts of many services.
- **No credit card.** When the credit is used up or the 12 months pass, the subscription is disabled. You cannot be billed by surprise; your shop simply stops. You can renew each year while you are still a student.
- **Sign up:** azure.microsoft.com/free/students → **Start free** → sign in with a Microsoft account → verify with your school email → open the Azure portal.

### The standard Azure free account (no school email)

- **What you get:** 200 US dollars of credit for 30 days, plus 12 months of popular services free and always-free amounts of others.
- **It asks for a phone number and a credit or debit card** to check that you are a real person. The card is not charged at sign-up.
- **After 30 days** (or when the credit is used) you must move to pay-as-you-go to keep going. Free amounts still apply; anything above them is billed to your card. That is why the budget in step 2 is not optional.

## 2. Guardrails, before you create anything

1. **Pick one region** close to you, and use it for everything. (All free SQL databases in a subscription must be in the same region.)
2. **Watch the money.**
   - *Azure for Students:* Cost Management budgets **do not support** this offer. Bookmark the **Azure Sponsorships portal** (microsoftazuresponsorships.com) and check your remaining credit every week while you build.
   - *Standard free account:* in the portal, open **Subscriptions** → your subscription → **Budgets** → **Add**. Set a small monthly amount and email alerts at, say, 50 % and 90 % of actual and forecast cost. **A budget warns you; it does not stop spending.** You still have to act on the email.
3. **Create the resource group** everything will live in:

   ```bash
   az login
   az group create --name rg-grocery-prod --location <your-region>
   ```

4. **Plan to delete.** When you no longer need the shop, `az group delete --name rg-grocery-prod` removes every resource in it. Note what your Capstone record and résumé link to before you do.

Install the Azure CLI (`az`) from Microsoft's "Install the Azure CLI" page if you do not have it. Every command here works in Bash; in PowerShell, replace the line-continuation `\` with a backtick.

## 3. The database: Azure SQL, free offer

Your schema already exists: the DACPAC from `db/` (.NET) or your Flyway migrations (Java).

1. In the portal, open **Azure SQL** → **Create** → **SQL databases: Single database**. Look for the banner **"Want to try Azure SQL Database for free?"** and select **Apply offer**.
2. Resource group `rg-grocery-prod`; database name `grocery`; create a new server (for example `sql-grocery-<your-initials>`) in your region.
3. **Authentication:** SQL authentication is the simplest start. Choose an admin login and a long generated password, and put the password straight into your password manager. It goes into Key Vault in step 5, nowhere else.
4. **When the free limit is reached:** choose **"Auto-pause the database until next month"**. The other choice, "continue using database for additional charges", cannot be switched back and bills your subscription.
5. **Networking:** public endpoint, but **no "Allow Azure services" tick yet** (step 4 adds exactly your API's addresses).

Things to know about the free database:

- It **pauses after about 15 minutes idle**, and the first request after that waits while it resumes. Your API must retry its first connection (both EF Core's and the JDBC driver's retry settings can do this).
- If the month's free compute runs out, it stays paused until the next calendar month.
- The free offer is not available on the "Azure for Students Starter" offer (a different, older offer from Azure for Students).

**In infrastructure as code** (DevOps stage): the database is a `Microsoft.Sql/servers/databases` resource with the serverless General Purpose SKU, `useFreeLimit: true` and `freeLimitExhaustionBehavior: 'AutoPause'`. Check the property names against the current Bicep reference when you write it.

## 4. The API: App Service, Free plan, your container image

Both stacks deploy the same way: App Service runs the **image your pipeline already builds** (`api/Dockerfile`), pulled from your public GitHub Container Registry package. This avoids depending on which .NET or Java versions App Service's built-in runtimes offer.

```bash
# A Linux plan on the Free tier
az appservice plan create --name plan-grocery --resource-group rg-grocery-prod --is-linux --sku F1

# The web app, running your image (public, so no registry password)
az webapp create --name api-grocery-<your-initials> --resource-group rg-grocery-prod \
  --plan plan-grocery --container-image-name ghcr.io/<your-github-user>/grocery-api:<commit-sha>

# Your container listens on 8080 (the .NET 8+ images and Spring Boot both default to it)
az webapp config appsettings set --name api-grocery-<your-initials> --resource-group rg-grocery-prod \
  --settings WEBSITES_PORT=8080

# Give the app its own identity (used for Key Vault in step 5)
az webapp identity assign --name api-grocery-<your-initials> --resource-group rg-grocery-prod
```

Your API is now at `https://api-grocery-<your-initials>.azurewebsites.net`. App Service ends HTTPS for you; your app itself serves plain HTTP on 8080.

**Let the API reach the database.** Add each of the app's outbound addresses to the SQL server's firewall:

```bash
az webapp show --name api-grocery-<your-initials> --resource-group rg-grocery-prod \
  --query outboundIpAddresses -o tsv
# then, for each address:
az sql server firewall-rule create --resource-group rg-grocery-prod --server sql-grocery-<your-initials> \
  --name api-1 --start-ip-address <address> --end-ip-address <address>
```

(The portal's "Allow Azure services and resources to access this server" switch also works, but it lets in services from *every* Azure customer, not just yours. If you use it, say so in your hosting ADR.)

What the Free (F1) plan means for your shop:

- **60 CPU minutes a day.** A small shop with a few test orders is well inside it; a load test is not. If you use it up, the app stops until the next day.
- **No Always On:** the app sleeps when idle and the first request wakes it, which takes a few seconds (longer for a Java app). Together with the database's auto-pause, the **first request after a quiet spell can be slow**. Say so in your SLO's exclusions and your release note.
- **No deployment slots.** Your hosting ADR says what you do instead (for example: a smoke test right after each deploy, and redeploying the previous image tag as your rollback).
- If F1 is not offered for a Linux container in your region, the next options are **Azure Container Apps** (a monthly free grant per subscription of 180,000 vCPU seconds, 360,000 GiB seconds and 2 million requests, and it scales to zero) or a paid App Service plan against your credit. Decide in your hosting ADR.

## 5. Secrets: Key Vault, read by the API's identity

No secret ever goes into your repository, your image, or a plain app setting.

```bash
az keyvault create --name kv-grocery-<your-initials> --resource-group rg-grocery-prod \
  --location <your-region> --enable-rbac-authorization true

# Let the API's identity read secrets (and nothing else)
principal=$(az webapp identity show --name api-grocery-<your-initials> --resource-group rg-grocery-prod --query principalId -o tsv)
vault=$(az keyvault show --name kv-grocery-<your-initials> --query id -o tsv)
az role assignment create --assignee-object-id "$principal" --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" --scope "$vault"
```

To add a secret you need the "Key Vault Secrets Officer" role on the vault yourself (assign it to your own account the same way). Then add, typing the values yourself:

| Secret name | What it holds |
|---|---|
| `shop-db` | the database connection string (.NET) or JDBC URL with user and password (Java) |
| `sandbox-key` | your delivery sandbox key (`gks_test_…`) |
| `sandbox-webhook-secret` | the sandbox's webhook signing secret |
| `payment-test-key` | your payment provider's **test** key, if your API uses one |
| `shop-key` / `shop-staff-code` | the key and staff code **your own API** accepts in production (generate new ones; never reuse Gurukul's) |

Point app settings at the secrets with **Key Vault references** — App Service fetches the value with the app's identity, and your code just reads an environment variable:

```bash
az webapp config appsettings set --name api-grocery-<your-initials> --resource-group rg-grocery-prod --settings \
  "ConnectionStrings__Shop=@Microsoft.KeyVault(SecretUri=https://kv-grocery-<your-initials>.vault.azure.net/secrets/shop-db/)" \
  "SHOP_KEY=@Microsoft.KeyVault(SecretUri=https://kv-grocery-<your-initials>.vault.azure.net/secrets/shop-key/)"
```

Use your own setting names: `ConnectionStrings__Shop` is the .NET form of `ConnectionStrings:Shop`; a Spring Boot app reads `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME` and `SPRING_DATASOURCE_PASSWORD`. The portal's **Environment variables** page shows a green tick beside each reference that resolved.

**Email (receipts).** Your deployment sends receipts through a cloud email service, as your email ADR says. On Azure that is Azure Communication Services Email with a free Azure-managed sending domain; sending is pay-as-you-go per email. Keep its connection string in Key Vault like the others.

## 6. Apply the schema

Your database starts empty. Apply the schema from the pipeline (step 9) or once by hand now.

- **Java (Flyway):** Spring Boot runs your migrations when the API starts. Nothing else to do; check the first start's log.
- **.NET (DACPAC):** publish it with SqlPackage from the deploy job. The job's runner is not on the firewall, so the job adds its own address for the step and removes it afterwards:

```bash
ip=$(curl -s https://api.ipify.org)
az sql server firewall-rule create -g rg-grocery-prod -s sql-grocery-<your-initials> -n deploy-runner \
  --start-ip-address "$ip" --end-ip-address "$ip"
sqlpackage /Action:Publish /SourceFile:db/bin/Release/Grocery.Db.dacpac \
  /TargetConnectionString:"$SHOP_DB"     # from an Actions secret, never echoed
az sql server firewall-rule delete -g rg-grocery-prod -s sql-grocery-<your-initials> -n deploy-runner
```

(Run the delete even when the publish fails: in GitHub Actions put it in a step with `if: always()`.)

## 7. The front end: Static Web Apps, Free plan

```bash
az staticwebapp create --name web-grocery-<your-initials> --resource-group rg-grocery-prod \
  --location <a-region-static-web-apps-offers> --sku Free
az staticwebapp secrets list --name web-grocery-<your-initials> --query properties.apiKey -o tsv
```

Put that deployment token into a GitHub **Actions secret** called `AZURE_STATIC_WEB_APPS_API_TOKEN` (repository **Settings → Secrets and variables → Actions**). Never into a file.

Your site's address is shown by `az staticwebapp show --name web-grocery-<your-initials> --query defaultHostname -o tsv` (it looks like `https://<words>.azurestaticapps.net`). **That is your shop's live address.**

**Deep links.** Add `staticwebapp.config.json` to the files your build outputs (Angular: `public/`; Vite: `public/`), so `/track` or `/orders/123` open your app instead of a 404:

```json
{ "navigationFallback": { "rewrite": "/index.html", "exclude": ["/assets/*", "*.{css,js,png,jpg,svg,ico,woff2}"] } }
```

**Point the build at your own API.** Your front end reads its API address and key from settings (UI stage):

- **Angular:** `src/environments/environment.production.ts` (or the file your project uses for the production configuration) holds `apiBaseUrl: 'https://api-grocery-<your-initials>.azurewebsites.net/<your API's base path>'`.
- **React (Vite):** `.env.production` holds `VITE_API_BASE_URL=https://api-grocery-<your-initials>.azurewebsites.net/<your API's base path>`.
- The **shop key** in a production build is the key your **own** API accepts (`shop-key` in Key Vault). Pass it at build time from an Actions secret or variable. Anything built into a browser bundle can be read by anyone who opens the page, so treat it as an identifier, not a secret: your staff code (typed by staff, never built in) is what protects staff routes. **Never put a Gurukul `gkshop_` key in a deployed build.**

## 8. Wire the tiers: CORS and the courier

- **CORS:** your API must allow your live address and nothing else in production. Either in your API's own CORS policy (from a setting) or in App Service:

  ```bash
  az webapp cors add --name api-grocery-<your-initials> --resource-group rg-grocery-prod \
    --allowed-origins https://<words>.azurestaticapps.net
  ```

  Use **one** of the two, not both: when App Service's CORS is set, it answers before your code does.
- **Payment return:** if your API checks a payment `returnUrl` against an allow-list, add your live address.
- **The courier's webhooks:** on Gurukul's **Sandbox** page, save `https://api-grocery-<your-initials>.azurewebsites.net/<your webhook route>` and send a **test ping**. The signing secret is `sandbox-webhook-secret` in Key Vault.

## 9. Deploy from GitHub Actions

The deploy job signs in to Azure **without any stored password**, using OpenID Connect and a user-assigned managed identity (this works even when your school's directory does not let you register apps).

**One-time setup:**

```bash
az identity create --name id-grocery-deploy --resource-group rg-grocery-prod
clientId=$(az identity show -n id-grocery-deploy -g rg-grocery-prod --query clientId -o tsv)
principalId=$(az identity show -n id-grocery-deploy -g rg-grocery-prod --query principalId -o tsv)
rg=$(az group show -n rg-grocery-prod --query id -o tsv)
az role assignment create --assignee-object-id "$principalId" --assignee-principal-type ServicePrincipal \
  --role Contributor --scope "$rg"

# Trust exactly your repository's "production" environment
az identity federated-credential create --name github-production --identity-name id-grocery-deploy \
  --resource-group rg-grocery-prod --issuer https://token.actions.githubusercontent.com \
  --subject repo:<your-github-user>/grocery:environment:production --audiences api://AzureADTokenExchange
```

In GitHub: **Settings → Environments → New environment** `production`, add yourself as a **required reviewer**, and add environment **variables** (not secrets — they are not secret) `AZURE_CLIENT_ID` = the client id, `AZURE_TENANT_ID` (`az account show --query tenantId -o tsv`) and `AZURE_SUBSCRIPTION_ID` (`az account show --query id -o tsv`).

**The workflow** (`.github/workflows/deploy.yml`, after your CI workflow passes on `main`):

```yaml
name: deploy
on:
  workflow_run:
    workflows: [ci]
    types: [completed]
    branches: [main]
permissions:
  id-token: write   # for the OIDC sign-in
  contents: read
jobs:
  deploy:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-latest
    environment: production          # waits for your approval
    steps:
      - uses: actions/checkout@v4
        with: { ref: '${{ github.event.workflow_run.head_sha }}' }
      - uses: azure/login@v2
        with:
          client-id: ${{ vars.AZURE_CLIENT_ID }}
          tenant-id: ${{ vars.AZURE_TENANT_ID }}
          subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}
      - name: Infrastructure
        run: az deployment group create -g rg-grocery-prod -f infra/main.bicep
      # .NET only: the schema step from section 6 goes here
      - name: API
        run: >
          az webapp config container set -g rg-grocery-prod -n api-grocery-<your-initials>
          --container-image-name ghcr.io/<your-github-user>/grocery-api:${{ github.event.workflow_run.head_sha }}
      - name: Front end build
        run: |
          cd web && npm ci && npm run build   # your production configuration
      - uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          action: upload
          app_location: web/dist/<your build folder>
          skip_app_build: true
      - name: Smoke test
        run: curl --fail --retry 5 --retry-delay 20 https://api-grocery-<your-initials>.azurewebsites.net/health
```

Adapt the paths and names to your repository. Use Terraform instead of Bicep if your ADR chose it (`hashicorp/setup-terraform`, the `azurerm` provider with `use_oidc = true`). The smoke test retries because a sleeping app and a paused database take a moment to wake.

**Gurukul's test kit against the deployed API (optional).** The kit can be pointed at any address (`SHOP_BASE_URL`, with `SHOP_KEY` and `SHOP_STAFF_CODE` for that API; see the kit's README). Two things to weigh first: it creates its own products and orders, and it needs the contract's test routes (`/dev/…`), which a production shop should not expose. Decide in your DevOps stage whether you run it there.

## 10. Check, then go live

- Open your live address. Browse, place a test order, pay on the test payment page, watch the courier statuses, track the order.
- In the portal, **rg-grocery-prod** should hold only: the SQL server and its database, the App Service plan and app, the static web app, the key vault, the deploy identity (and Application Insights or a Communication Services resource if you added them).
- Check your credit (Sponsorships portal) or your budget the next day.

When you are done with the shop for good: `az group delete --name rg-grocery-prod`.

---

## Sources (read 2026-10-29)

- Azure for Students: https://azure.microsoft.com/en-us/free/students and the offer terms https://azure.microsoft.com/en-us/offers/ms-azr-0170p/
- The Azure free account: https://azure.microsoft.com/en-us/pricing/purchase-options/azure-account
- Offers Cost Management supports (Azure for Students is not one): https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/understand-cost-mgt-data
- Budgets: https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets
- Azure SQL Database free offer: https://learn.microsoft.com/en-us/azure/azure-sql/database/free-offer
- App Service limits (Free tier): https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/azure-subscription-service-limits#app-service-limits
- Custom containers on App Service (`WEBSITES_PORT`): https://learn.microsoft.com/en-us/azure/app-service/configure-custom-container
- Static Web Apps plans and quotas: https://learn.microsoft.com/en-us/azure/static-web-apps/plans and https://learn.microsoft.com/en-us/azure/static-web-apps/quotas
- Container Apps pricing (monthly free grant): https://azure.microsoft.com/en-us/pricing/details/container-apps/
- Key Vault pricing: https://azure.microsoft.com/en-us/pricing/details/key-vault/
