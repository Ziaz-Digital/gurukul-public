# Deploy your Capstone shop to AWS

This guide takes your finished grocery shop (database, API and front end) from your laptop to **your own AWS account**, deployed by your own GitHub Actions pipeline. It assumes you have never deployed anything before. Follow it in order.

While you build, nothing here is needed: your front end runs on your laptop against Gurukul's shop server with your shop key, and Gurukul's test kit runs in your pipeline. You deploy in the **DevOps** stage, and go live from that deployment in the **Release** stage.

> **Prices, credits and free offers: as of October 2026 — check the current offer.** Every number below was read on AWS's own pages on 2026-10-29. Offers change. If an official page says something different when you read it, the official page wins. Links are at the end.

What you will end up with, all in one Region and tagged `app=grocery`:

| Tier | AWS service | What it costs you (as of October 2026) |
|---|---|---|
| Database | Amazon RDS for SQL Server **Express**, one `db.t3.micro` instance, no public access | On the Free plan, RDS is paid for from your credits (the Free plan offers `db.t3.micro` and `db.t4g.micro` for SQL Server Express). |
| API | AWS Elastic Beanstalk, **single-instance** Docker environment on one small EC2 instance, running your API's container image | Elastic Beanstalk itself costs nothing; the EC2 instance (and its public IPv4 address) bill by the hour, from your credits. `t3.micro` is one of the Free plan's eligible types. |
| Front end | Amazon S3 (private bucket) behind **Amazon CloudFront** | S3 storage for a few MB is drawn from your credits. CloudFront offers a flat-rate **Free** plan (as of October 2026: 0 US dollars a month per distribution, up to 1 million requests and 100 GB). |
| Secrets | AWS Systems Manager **Parameter Store** (standard `SecureString` parameters) | Standard parameters are free. (AWS Secrets Manager also works: 0.40 US dollars per secret per month plus API calls.) |
| Alerts | AWS Budgets | Budget monitoring and alerts are free. |

Your API image is the **public GitHub Container Registry package** your pipeline already builds and scans (DevOps stage, R8), so you need no paid container registry.

---

## 1. Sign up

AWS gives new accounts (opened on or after 15 July 2025):

- **100 US dollars of credits at sign-up**, and up to **100 US dollars more** for completing activities in the console's "Explore AWS" widget.
- A choice of plan:
  - **Free plan** — never charges you. It offers select services, and it **ends after 6 months or when your credits are used, whichever comes first**. Then the account closes; AWS keeps your content for 90 days, and if you have not upgraded to the Paid plan by then, the account and everything in it are deleted.
  - **Paid plan** — every service; the credits are spent first, then your card is billed.
- **Payment method:** AWS says most new customers need no payment method to sign up, but it may ask for one (and a phone number) to verify who you are.
- **Do not join AWS Organizations or set up Control Tower** on the Free plan: either moves the account to the Paid plan automatically.
- **The Free plan offers select services only.** AWS's Free Tier page lists them; EC2, RDS and S3 are on both plans. If the console tells you a service in this guide is not available on your plan, the choice is to upgrade to the Paid plan (credits are still spent first) or to pick an alternative in your hosting ADR.

> **Plan for the six months.** On the Free plan your live shop stops when the plan ends. If your Capstone's live address must outlive that, you will have to upgrade to the Paid plan (credits first, then your card) or tear the shop down and say so. Decide before you go live, and note the date your plan ends.

Sign up at aws.amazon.com/free. AWS Educate (free labs, an email address only) is useful practice, but it is not an account you can deploy your shop to.

## 2. Guardrails, before you create anything

1. **Lock the root user:** a strong password and MFA, and **no access keys** for root. Create an IAM Identity Center or IAM user for daily work, with its own MFA. Sign the AWS CLI in with that user (for example `aws configure sso`, or `aws login` on a current CLI) rather than storing long-lived keys on your laptop.
2. **Pick one Region** close to you and use it for everything except CloudFront, which is global.
3. **A budget with email alerts:** **Billing and Cost Management → Budgets → Create budget**, a monthly cost budget, alerts at, say, 50 % and 90 % of actual and forecast cost. Leave credits **out** of the budget so it measures what you really use. **A budget warns you; it does not stop spending.**
4. **Watch your credits and plan end date** on the Billing and Cost Management home page.
5. **Tag everything `app=grocery`**, and create a **resource group** in AWS Resource Groups based on that tag, so you can see the whole shop in one list.
6. **Plan to delete.** Deleting your infrastructure-as-code stack (step 9) removes the shop. Note what your Capstone record and résumé link to before you do.

## 3. The database: RDS for SQL Server Express

Your schema already exists: the DACPAC from `db/` (.NET) or your Flyway migrations (Java). Both run against SQL Server.

Create it in your infrastructure as code (step 9), or once in the console to learn the screens:

- Engine **Microsoft SQL Server**, edition **Express**; template **Free tier** if the console offers it; instance class **`db.t3.micro`** (the console lists only the classes your engine supports).
- **Public access: No.** The database lives in your default VPC's private network; only the API's security group may connect, on port 1433.
- **Master password:** let RDS manage it in Secrets Manager, or generate one into your password manager. It goes into Parameter Store in step 5, nowhere else.
- Storage: the smallest General Purpose (gp3) size the console allows; no Multi-AZ; automated backups on with a short retention.
- **Snapshots cost storage.** When you delete the database at the end, decide whether you want a final snapshot.

Two things specific to RDS for SQL Server:

- **It starts with no database of your own.** Your API's start-up should connect to `master`, run `CREATE DATABASE grocery` if it does not exist, then apply the schema (step 6).
- **TLS:** RDS signs its certificates with its own certificate authority. Add the RDS CA bundle to your API image's trust store (AWS's "Using SSL/TLS to encrypt a connection to a DB instance" page links the bundle) instead of switching certificate checks off with `TrustServerCertificate=true`.

## 4. The API: Elastic Beanstalk, single instance, your container image

Both stacks deploy the same way: Elastic Beanstalk runs the **image your pipeline already builds** (`api/Dockerfile`), pulled from your public GitHub Container Registry package. That avoids depending on which .NET or Java versions Beanstalk's own platforms offer.

1. Create an application `grocery` and an environment `grocery-prod`:
   - Platform **Docker** (on Amazon Linux 2023, the current platform version).
   - **Single instance** (not load balanced): no load balancer to pay for by the hour.
   - Instance type **`t3.micro`**. Turn **unlimited CPU credits off** if the console offers it: a `t3` in "unlimited" mode can bill extra CPU.
   - An **instance profile** role that may read your parameters (step 5) and nothing more.
2. Tell Beanstalk which image to run with a `Dockerrun.aws.json` (version 1), zipped as the application version:

   ```json
   {
     "AWSEBDockerrunVersion": "1",
     "Image": { "Name": "ghcr.io/<your-github-user>/grocery-api:<commit-sha>", "Update": "true" },
     "Ports": [ { "ContainerPort": 8080 } ]
   }
   ```

   Your container listens on 8080 (the .NET 8+ images and Spring Boot both default to it).
3. Give the environment's security group the right to reach the database's security group on 1433, and nothing else.

A single-instance environment answers on `http://grocery-prod.<id>.<region>.elasticbeanstalk.com` — **HTTP only**. A page served over HTTPS cannot call an HTTP API, so the next step puts the API behind the same HTTPS address as your front end.

## 5. Secrets: Parameter Store, read by the instance

No secret ever goes into your repository, your image, or a plain environment setting.

Create standard `SecureString` parameters, typing the values yourself:

| Parameter | What it holds |
|---|---|
| `/grocery/prod/shop-db` | the database connection string (.NET) or JDBC URL (Java) |
| `/grocery/prod/db-password` | the database password, if not in the connection string |
| `/grocery/prod/sandbox-key` | your delivery sandbox key (`gks_test_…`) |
| `/grocery/prod/sandbox-webhook-secret` | the sandbox's webhook signing secret |
| `/grocery/prod/payment-test-key` | your payment provider's **test** key, if your API uses one |
| `/grocery/prod/shop-key`, `/grocery/prod/shop-staff-code` | the key and staff code **your own API** accepts in production (generate new ones; never reuse Gurukul's) |

Elastic Beanstalk can put each one into an **environment variable** for you: in the environment's configuration, under environment properties, add a *secret* whose value is the parameter's ARN (or, in a config file, the `aws:elasticbeanstalk:application:environmentsecrets` namespace). This needs a platform version released on or after 26 March 2025, and the instance profile needs `ssm:GetParameter` on those parameters. Beanstalk reads them when an instance starts; after you change a value, restart the app or redeploy.

Use your own variable names: `ConnectionStrings__Shop` is the .NET form of `ConnectionStrings:Shop`; a Spring Boot app reads `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME` and `SPRING_DATASOURCE_PASSWORD`.

**Email (receipts).** Your deployment sends receipts through a cloud email service, as your email ADR says. On AWS that is Amazon SES; a new SES account starts in the sandbox, where it sends only to addresses you have verified, which is enough for test orders. Check SES pricing before you send.

## 6. Apply the schema

The database is private, so your pipeline's runner cannot reach it. Let the API apply the schema when it starts:

- **Java (Flyway):** Spring Boot runs your migrations at start-up. Nothing else to do; check the first start's log.
- **.NET (DACPAC):** add a start-up step (or a small one-off command in the same image) that deploys the DACPAC with the `Microsoft.SqlServer.DacFx` package. A DACPAC deploy compares and only changes what differs, so running it on every start is safe; log what it changed.

## 7. The front end: S3 and CloudFront, with the API behind the same address

1. **An S3 bucket** for the built files, **Block Public Access on**.
2. **A CloudFront distribution** with two origins:
   - **Default behaviour → the S3 bucket**, through **Origin Access Control**, so only CloudFront can read it. Cache as normal.
   - **A behaviour for your API's path** (for example `/api/*`) **→ the Beanstalk environment's address**, origin protocol **HTTP only**, allowed methods **all** (GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE), cache policy **CachingDisabled**, origin request policy **AllViewerExceptHostHeader** (so your headers, such as `X-Shop-Key`, `Authorization` and the courier's signature headers, reach the API).
   - Choose the flat-rate **Free** pricing plan for the distribution if it is offered to you.
3. **Deep links:** add a small **CloudFront Function** (viewer request) on the **default behaviour only** that rewrites any path without a file extension to `/index.html`. Do **not** use the distribution's custom error pages for this: they would also replace your API's 404 answers with your home page.

Your site's address is `https://<id>.cloudfront.net`. **That is your shop's live address**, and your API answers under it too, over HTTPS.

**Point the build at your own API.** Your front end reads its API address and key from settings (UI stage):

- **Angular:** the production environment file holds `apiBaseUrl: 'https://<id>.cloudfront.net/api'` (or just `/api`, the same address).
- **React (Vite):** `.env.production` holds `VITE_API_BASE_URL=https://<id>.cloudfront.net/api`.
- The **shop key** in a production build is the key your **own** API accepts (`/grocery/prod/shop-key`). Pass it at build time from an Actions secret or variable. Anything built into a browser bundle can be read by anyone who opens the page, so treat it as an identifier, not a secret: your staff code (typed by staff, never built in) is what protects staff routes. **Never put a Gurukul `gkshop_` key in a deployed build.**

## 8. Wire the tiers: CORS and the courier

- **CORS:** because the front end and the API share one address, the browser's calls are same-origin and CORS does not come into it. Keep your API's production CORS list to your CloudFront address anyway, so no other site is allowed (your development settings can add `http://localhost:<port>`).
- **Payment return:** if your API checks a payment `returnUrl` against an allow-list, add your live address.
- **The courier's webhooks:** on Gurukul's **Sandbox** page, save `https://<id>.cloudfront.net/api/<your webhook route>` and send a **test ping**. The signing secret is `/grocery/prod/sandbox-webhook-secret`.

## 9. Deploy from GitHub Actions

Everything above goes into **infrastructure as code** under `infra/`: CloudFormation, the AWS CDK (v2, `aws-cdk-lib`) or Terraform, whichever your hosting ADR chose. The deploy job signs in **without any stored key**, through OpenID Connect.

**One-time setup:**

1. In IAM, add an **OpenID Connect identity provider**: provider URL `https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`.
2. Create a **role** for the deploy job whose trust policy allows that provider only for your repository's `production` environment:

   ```json
   "Condition": {
     "StringEquals": {
       "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
       "token.actions.githubusercontent.com:sub": "repo:<your-github-user>/grocery:environment:production"
     }
   }
   ```

   Give it only what the deploy needs (your stack, the bucket, CloudFront invalidations, Beanstalk application versions).
3. In GitHub: **Settings → Environments → New environment** `production`, add yourself as a **required reviewer**, and add environment variables `AWS_ROLE_ARN` and `AWS_REGION`. Your account number is not a secret, but replace it with `ACCOUNT` in anything you paste into a submission.

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
    env:
      SHA: ${{ github.event.workflow_run.head_sha }}
    steps:
      - uses: actions/checkout@v4
        with: { ref: '${{ github.event.workflow_run.head_sha }}' }
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.AWS_ROLE_ARN }}
          aws-region: ${{ vars.AWS_REGION }}
      - name: Infrastructure
        run: |
          cd infra && npm ci && npx cdk deploy --require-approval never   # or: terraform apply / aws cloudformation deploy
      - name: API
        run: |
          sed "s/<commit-sha>/$SHA/" deploy/Dockerrun.aws.json > Dockerrun.aws.json
          zip api-$SHA.zip Dockerrun.aws.json
          aws s3 cp api-$SHA.zip s3://<your-deploy-bucket>/api-$SHA.zip
          aws elasticbeanstalk create-application-version --application-name grocery \
            --version-label $SHA --source-bundle S3Bucket=<your-deploy-bucket>,S3Key=api-$SHA.zip
          aws elasticbeanstalk update-environment --environment-name grocery-prod --version-label $SHA
          aws elasticbeanstalk wait environment-updated --environment-names grocery-prod
      - name: Front end
        run: |
          cd web && npm ci && npm run build      # your production configuration
          aws s3 sync dist/<your build folder> s3://<your-site-bucket> --delete
          aws cloudfront create-invalidation --distribution-id <id> --paths "/index.html"
      - name: Smoke test
        run: curl --fail --retry 5 --retry-delay 20 https://<id>.cloudfront.net/api/health
```

Adapt the paths and names to your repository. Keep your bucket names, distribution id and Beanstalk names in the infrastructure code's outputs or in environment variables, not typed into the workflow by hand.

**Gurukul's test kit against the deployed API (optional).** The kit can be pointed at any address (`SHOP_BASE_URL`, with `SHOP_KEY` and `SHOP_STAFF_CODE` for that API; see the kit's README). Two things to weigh first: it creates its own products and orders, and it needs the contract's test routes (`/dev/…`), which a production shop should not expose. Decide in your DevOps stage whether you run it there.

## 10. Check, then go live

- Open your live address. Browse, place a test order, pay on the test payment page, watch the courier statuses, track the order.
- Your `app=grocery` resource group should list only: the database, the Beanstalk environment and its instance, the two buckets, the distribution, the parameters and the deploy role.
- Check your credits and your budget the next day, and note when your Free plan ends.

When you are done with the shop for good, delete the stack (`npx cdk destroy`, `terraform destroy`, or delete the CloudFormation stack), then empty and delete anything it kept (S3 buckets with objects, RDS snapshots).

---

## Sources (read 2026-10-29)

- AWS Free Tier and its plans: https://aws.amazon.com/free/ and https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html
- Free Tier FAQs (payment method, credits, what happens at the end): https://aws.amazon.com/free/free-tier-faqs/
- RDS on the Free plan: https://aws.amazon.com/rds/free/
- EC2 Free Tier instance types: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-free-tier-usage.html
- Elastic Beanstalk pricing: https://aws.amazon.com/elasticbeanstalk/pricing/
- Elastic Beanstalk secrets as environment variables: https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/AWSHowTo.secrets.env-vars.html
- CloudFront pricing (flat-rate plans): https://aws.amazon.com/cloudfront/pricing/
- AWS Budgets pricing: https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/
- Secrets Manager pricing: https://aws.amazon.com/secrets-manager/pricing/
- Systems Manager pricing (Parameter Store): https://aws.amazon.com/systems-manager/pricing/
