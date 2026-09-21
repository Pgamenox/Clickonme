# ClickOnMe Security

## Reporting a security issue

Do not publish credentials, customer data, payment details, private keys, access tokens, or exploit details in a public issue.

Security-sensitive changes must be reviewed by the repository owner before production deployment.

## Protected information

The following must never be committed to this repository:

- Supabase service-role keys
- Mercado Pago access tokens
- Resend API keys
- GitHub personal access tokens
- Private keys or certificates
- Database passwords or full database connection strings
- Customer passwords or authentication tokens

Only publishable/browser-safe keys may appear in client-side code.

## Recovery

The production code must always have a known restore point and an external backup copy. Database and storage backups are handled separately from the source-code backup.

## Change control

Security, authentication, payments, administrator permissions, database policies, and deployment workflows are considered sensitive areas. Changes to these areas should pass automated QA and security checks before production use.
