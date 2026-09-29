# Déploiement sur Cloudflare Workers

Cette application est prête pour un déploiement propre, performant et scalable sur **Cloudflare Workers** (avec prise en charge des **Static Assets** et du routage API Edge).

---

## Architecture de déploiement

- **Assets Statiques** : Le dossier de production `dist/` (Cesium, shaders, modèles 3D, tiles, scripts minifiés) est hébergé et distribué globalement via le CDN de Cloudflare Assets avec compression brotli/gzip automatique.
- **Worker Edge (`worker/index.js`)** :
  - Intercepte et proxyfie les flux temps réel (`/api/celestrak`, `/api/adsblol`, `/api/launches`, `/api/geocode`, `/api/overpass`, `/api/firms`, etc.) avec cache intelligent via l'API Edge `caches.default`.
  - Assure le routage SPA (Single Page Application fallback vers `/index.html`).
  - Injecte les en-têtes de sécurité (`X-Content-Type-Options`, `Referrer-Policy`, `CORS`).

---

## 1. Déploiement direct avec Wrangler

### Prérequis
Assurez-vous d'être connecté à votre compte Cloudflare :
```bash
npx wrangler login
```

### Déployer
Lancez la commande de build et de déploiement automatique :
```bash
npm run deploy
```

La commande exécute `npm run build` puis `wrangler deploy` pour publier votre application sur votre sous-domaine Cloudflare Workers (ex: `https://gods-eye-view.<votre-nom>.workers.dev`).

---

## 2. Configuration des secrets et variables d'environnement

Si vous utilisez des clés d'API externes (optionnelles), configurez-les directement dans Cloudflare :

```bash
# NASA FIRMS (feux actifs)
npx wrangler secret put FIRMS_MAP_KEY

# OpenAI Realtime (commandes vocales)
npx wrangler secret put OPENAI_API_KEY

# TomTom Traffic (trafic routier)
npx wrangler secret put TOMTOM_API_KEY

# OpenSky Network
npx wrangler secret put OPENSKY_CLIENT_ID
npx wrangler secret put OPENSKY_CLIENT_SECRET
```

---

## 3. Test local du Worker

Pour tester le comportement exact du Worker et des assets statiques en local :
```bash
npm run preview:worker
```
Cela démarre l'émulateur Miniflare/Wrangler local.

---

## 4. Déploiement automatique via GitHub Actions

Un workflow CI/CD est inclus dans `.github/workflows/deploy-cloudflare.yml`.

Pour l'activer, configurez ces deux variables secrètes dans votre dépôt GitHub (`Settings > Secrets and variables > Actions`) :
- `CLOUDFLARE_API_TOKEN` : Token généré sur le dashboard Cloudflare (avec permissions *Cloudflare Workers: Edit*).
- `CLOUDFLARE_ACCOUNT_ID` : L'identifiant de votre compte Cloudflare.

À chaque push sur la branche `main`, votre application sera automatiquement construite et déployée sur Cloudflare Workers.
