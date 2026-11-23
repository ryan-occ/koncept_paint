---
name: Passcode login storage
description: Operational dependency for shared passcode rate limiting.
---

The passcode login depends on a shared PostgreSQL rate-limit table. Adding its SQL definition to the project does not automatically provision the table; if it is missing, login intentionally fails closed with a 503.

**Why:** Preview login recovered after the missing table was applied to the development database, and the user confirmed they could log in.

**How to apply:** When login protection is unavailable, check database connectivity and the table in the affected environment. Keep the fail-closed behavior; do not add startup-time DDL. Use the appropriate Replit database workflow for development or production schema changes.
