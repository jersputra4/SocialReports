SHELL := /bin/bash
COMPOSE := docker compose

.DEFAULT_GOAL := help

help: ## Tampilkan daftar perintah
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

env: ## Siapkan file .env dari contoh
	@test -f .env || (cp .env.example .env && echo "Dibuat: .env")

up: env ## Jalankan seluruh stack
	$(COMPOSE) up -d --build
	$(COMPOSE) run --rm migrate
	@echo "Aplikasi siap di http://localhost:$${APP_PORT:-8080}"

down: ## Hentikan stack
	$(COMPOSE) down

reset: ## Hentikan stack dan hapus seluruh data
	$(COMPOSE) down -v

logs: ## Ikuti log API dan worker
	$(COMPOSE) logs -f api worker

migrate: ## Jalankan migrasi + seed
	$(COMPOSE) run --rm migrate

psql: ## Buka psql ke database
	$(COMPOSE) exec postgres psql -U $${POSTGRES_USER:-srs} -d $${POSTGRES_DB:-social_report}

create-admin: ## Buat akun admin pertama (CLI sekali pakai)
	$(COMPOSE) exec api node dist/cli/create-admin.js

smoke: ## Jalankan smoke test end-to-end terhadap stack yang berjalan
	node scripts/smoke-test.mjs

verify-audit: ## Verifikasi hash chain audit log
	$(COMPOSE) exec api node dist/cli/verify-audit-chain.js

.PHONY: help env up down reset logs migrate psql create-admin smoke verify-audit
