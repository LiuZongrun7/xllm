# xLLM — Food Delivery Website

**COMP3019J Web Application Development 2026/27 · Final Project · Topic 7**

Team **xLLM**: Fu Rao · Liu Jing · Liu Zongrun · Zhou Jiaxu

Live deployment: **https://xllm.cloud**

---

## What this is

A local food-delivery platform connecting three parties — **customers**, **restaurants** and
**delivery riders** — over one shared order. The project is built around two things the topic
states explicitly: a **shared order state machine** that three roles advance in turn, and
**role-based information isolation** enforced on the server (`without giving everyone access to
the same information`).

Scope, requirements (`FR-1` … `FR-26`) and design rationale are in
[`docs/M1-设计报告.md`](docs/M1-设计报告.md).

## Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.10 · Flask 3.1 · SQLAlchemy 2.0 |
| Database | MySQL 8 (11 tables) |
| Templates | Jinja2 |
| Front end | HTML5 · CSS3 · vanilla JS |
| Deployment | nginx (TLS) + gunicorn + systemd |
| Map | Amap (Gaode) JS API + Web service API — declared under brief §4 |

## Repository layout

```
server/            Flask application
├── app.py         application factory (single entry point)
├── shared/        models · security · auth · mailer · health   (shared layer)
├── customer/      customer pages + /api/customer endpoints
├── merchant/      merchant pages + /api/merchant endpoints
└── rider/         rider pages   + /api/rider endpoints
database/          schema.sql · ER diagrams
docs/              reports, design docs, deployment guide
deploy/            systemd unit
tools/             one-off verification pages
```

**The directory tree *is* the division of work** — one folder per role, so each member can open
their own slice during the demonstration. Details: [`docs/代码结构.md`](docs/代码结构.md).

Two things are deliberately *not* per-role: `shared/models.py` and the order state machine.
Duplicating those would give one order three implementations.

## Design

The three interfaces are **three independent design systems**, not three skins over one layout —
customers browse on a phone, restaurants work a dense desktop queue, riders operate one-handed
outdoors. What they share is not pixels but terminology, data and API contract.
See [`docs/设计语言.md`](docs/设计语言.md) and the live specimens:

- https://xllm.cloud/customer/design-system
- https://xllm.cloud/merchant/design-system
- https://xllm.cloud/rider/design-system

## Running locally

```bash
cd server
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env      # then fill in DB_PASSWORD / SECRET_KEY / MAIL_*
python app.py             # http://127.0.0.1:8080
```

| URL | Purpose |
|---|---|
| `/api/ping` | liveness |
| `/api/db-ping` | database connectivity |
| `/customer/design-system` | customer design system specimen |
| `/merchant/design-system` | merchant design system specimen |
| `/rider/design-system` | rider design system specimen |

## Documentation

| Document | Contents |
|---|---|
| [`docs/M1-设计报告.md`](docs/M1-设计报告.md) | Milestone 1 design report (English) |
| [`docs/项目规划.md`](docs/项目规划.md) | scope, risks, roadmap, division of work |
| [`docs/架构`](docs/代码结构.md) · [`docs/代码结构.md`](docs/代码结构.md) | who owns which file |
| [`docs/数据库设计.md`](docs/数据库设计.md) | schema rationale |
| [`docs/认证设计.md`](docs/认证设计.md) | login / verification-code / password-reset design |
| [`docs/设计语言.md`](docs/设计语言.md) | three independent design systems |
| [`docs/部署说明.md`](docs/部署说明.md) | nginx, gunicorn, deploy and rollback |

## Not in this repository

- `.env` — secrets live on the server only; `.env.example` lists the keys
- `docs/reference/` third-party screenshots and course PDFs — see
  [`docs/reference/README.md`](docs/reference/README.md)
