---
name: Photo-to-mix matching scope
description: Product boundary for formulas inferred from uploaded car-paint photos.
---

Photo matching should return the closest achievable mix from the app's current toner set. Do not present an image-derived result as an exact factory formula; exact OEM formulas require a paint code and supplier or manufacturer formula data.

Multi-angle predictions use face-on, mid-angle, and grazing categories with an approximate effect-material model. They are not a spectral or calibrated directional-reflectance simulation.

**Why:** The user chose a closest-available mix after learning that ordinary photos cannot identify a unique OEM recipe.

**How to apply:** Preserve the estimate-versus-OEM distinction in photo matching, result labels, and future paint-code lookup work; describe angle scoring as approximate unless measured spectrophotometer data is added.
