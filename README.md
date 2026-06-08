# gpu-price-finder

Find cheap GPU routes from your terminal.

Search live cloud GPU pricing for RTX 3090, RTX 4090, RTX 5090, L40S, A100, H100, and other GPU types without creating an account.

```bash
npx gpu-price-finder --gpu RTX_4090 --max-price 1
```

No login.
No account.
No API key.

Powered by AI Badgr. Find cheap GPU routes. Run workloads with spend caps.

---

## Find the Cheapest GPU Route

GPU rental prices change constantly.

Instead of checking multiple cloud GPU providers manually, `gpu-price-finder` lets you compare available GPU routes directly from your terminal.

Use it to search:

* Cheap RTX 4090 rental
* Cheap RTX 3090 rental
* RTX 5090 cloud GPU pricing
* L40S GPU rental
* A100 cloud GPU pricing
* H100 GPU rental pricing
* GPU rental availability by region
* Low-cost GPU routes for AI, rendering, training, inference, simulation, and other GPU-heavy workloads

---

## Quick Start

Search for the cheapest available RTX 4090 route:

```bash
npx gpu-price-finder --gpu RTX_4090
```

Set a maximum hourly price:

```bash
npx gpu-price-finder --gpu RTX_4090 --max-price 1
```

Filter by region:

```bash
npx gpu-price-finder --gpu L40S --region US
```

Search lower-cost routes:

```bash
npx gpu-price-finder --gpu A100 --tier 2
```

Get JSON output:

```bash
npx gpu-price-finder --gpu H100 --json
```

---

## Example Output

```text
Searching AI Badgr routes...

Cheapest RTX_4090 routes:

1. Source 1   $0.53/hr   Tier 2   US   available
2. Source 2   $0.86/hr   Tier 1   EU   available
3. Source 3   $0.92/hr   Tier 2   US   available

Recommendation
Use:

npx gpu-price-finder --gpu RTX_4090 --max-price 1

Powered by AI Badgr.
Find cheap GPU routes. Run workloads with spend caps.
```

Route sources are masked. Underlying provider details, host IDs, and internal offer IDs are never shown.

---

## How GPU Route Search Works

AI Badgr searches across multiple GPU capacity sources and returns available GPU rental routes based on your filters.

Routes are grouped by tier.

### Tier 1

Managed GPU routes optimized for:

* Reliability
* Smoother startup
* More predictable availability
* Production workloads

### Tier 2

Lower-cost GPU routes optimized for:

* Cheapest available pricing
* Price-sensitive workloads
* Batch jobs
* Experiments
* Flexible compute demand

Provider details are abstracted.

You compare:

* GPU type
* Hourly GPU price
* Region
* Tier
* Availability

without needing to compare individual providers manually.

---

## Supported GPU Types

Examples include:

* RTX 3090
* RTX 4090
* RTX 5090
* L40S
* A100
* H100

Other accelerator types may also be available depending on live capacity.

---

## CLI Options

```bash
--gpu RTX_4090
--region US
--max-price 1
--tier 1
--tier 2
--sort price
--limit 5
--json
```

Defaults:

```text
GPU: RTX_4090
Tier: Any
Sort: Price
Limit: 5
```

---

## Common GPU Search Examples

### Find a cheap RTX 4090 rental

```bash
npx gpu-price-finder --gpu RTX_4090 --max-price 1
```

### Find an RTX 4090 in the US

```bash
npx gpu-price-finder --gpu RTX_4090 --region US
```

### Find a low-cost RTX 3090 route

```bash
npx gpu-price-finder --gpu RTX_3090 --tier 2
```

### Compare L40S GPU rental prices

```bash
npx gpu-price-finder --gpu L40S --sort price
```

### Find an A100 GPU under $3 per hour

```bash
npx gpu-price-finder --gpu A100 --max-price 3
```

### Find an H100 route in Europe

```bash
npx gpu-price-finder --gpu H100 --region EU
```

### Use JSON output in a script

```bash
npx gpu-price-finder --gpu RTX_4090 --json
```

---

## Run a GPU Workload

Found a route you want to use?

Install the AI Badgr CLI:

```bash
npm install -g badgr-cli
badgr login
```

Run a GPU job:

```bash
badgr run "<your-command>" --gpu RTX_4090 --tier 2 --max-price 0.53 --max-runtime 60
```

Serve a model:

```bash
badgr serve <model-or-image> --gpu L40S --max-cost 10
```

AI Badgr supports:

* GPU job routing
* Max hourly price controls
* Max runtime controls
* Max total cost controls
* Logs
* Teardown
* Receipts

---

## Use Cases

`gpu-price-finder` is useful for finding affordable GPU rental routes for:

1. AI model training
2. LLM inference
3. Open-source model serving
4. Fine-tuning and LoRA training
5. ComfyUI workflows
6. Image generation
7. Video generation
8. Batch inference
9. Embeddings and vector generation
10. Speech-to-text transcription
11. Text-to-speech generation
12. 3D rendering
13. Animation rendering
14. Video rendering and encoding
15. Scientific computing
16. Data processing and analytics
17. Simulation workloads
18. GPU-accelerated development and testing
19. Compute-heavy scripts and experiments
20. Crypto mining

---

## Public API

The CLI uses the public AI Badgr GPU route search endpoint:

```text
GET https://aibadgr.com/v1/capacity/search
```

Supported query parameters:

```text
gpu
region
max_price
tier
sort
limit
```

The API returns provider-neutral GPU route data.

---

## Open Source

`gpu-price-finder` is open source.

The package contains:

* CLI argument parsing
* Public GPU route-search requests
* Route normalization
* Text output
* JSON output
* Conversion instructions for `badgr-cli`

AI Badgr's backend remains private, including:

* Capacity aggregation
* GPU source integrations
* Route scoring
* Pricing logic
* Execution routing
* Provider selection
* Margin logic

---

## Why AI Badgr?

AI Badgr abstracts the GPU provider layer.

You search GPU routes, compare live prices, choose a tier, and run workloads without manually hunting across multiple GPU rental sources.

---

## License

MIT
