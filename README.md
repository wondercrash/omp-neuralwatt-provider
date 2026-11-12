# omp-neuralwatt-provider

[Neuralwatt](https://neuralwatt.com) model provider for [oh-my-pi](https://github.com/can1357/oh-my-pi) (omp). It registers the provider id `neuralwatt` and uses omp's built-in `openai-completions` transport against `https://api.neuralwatt.com/v1`.

## Requirements

omp ≥ 18.19.0.

## Install

From a checkout:

```sh
omp plugin link /path/to/omp-neuralwatt-provider
```

From a git host:

```sh
omp plugin install github:<owner>/omp-neuralwatt-provider
```

Restart omp afterwards.

## Authentication

Either set `NEURALWATT_API_KEY`, or sign in with `/login neuralwatt`, `omp login neuralwatt`, or `/providers`. A key stored via `/login` takes precedence over the environment variable. Create keys at <https://portal.neuralwatt.com> (Dashboard > API Keys).

## Models

Models are discovered from `GET /v1/models`, cached for 24 hours, and refreshed with `omp models refresh`. Select one as `neuralwatt/<id>`, for example `neuralwatt/nw-flash`. With a key, the account's private models are listed too. Embedding and decision models are skipped.

## Thinking levels

omp thinking levels map 1:1 onto Neuralwatt's `reasoning_effort`. Each model offers the levels listed in its `supported_efforts`. Thinking off sends `reasoning_effort: "none"`; models with mandatory reasoning run at their lowest level instead.

## Usage

`/usage` and `omp usage --provider neuralwatt` show the USD credit balance, the subscription energy allowance (as a percentage, with kWh in the note), and the per-key spending allowance.

## `/neuralwatt-energy`

Prints requests, kWh, joules and CO2e consumed over the last 30 days.

## Limitations

Per-request energy is not shown: Neuralwatt sends it as SSE comments, which omp's transport drops.

## Development

```sh
bun install
bun test
bun run typecheck
```
