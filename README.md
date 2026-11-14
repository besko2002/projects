# Projects

Each folder is a self-contained project with its own README, setup and tests.

For native macOS startup (HR, movies, AI documents, and image colorization), see
[NATIVE.md](NATIVE.md). Only the order-processing microservices stack needs Docker for
its normal local runtime; Docker remains optional for integration tests in the other projects.

| Project | What it is |
|---|---|
| [image-colorization](image-colorization/) | Image colorization website: Python backend with a simple web frontend. |
| [order-processing-microservices](order-processing-microservices/) | Event-driven order flow: six Spring Boot microservices talking through Kafka (saga, outbox, JWT, observability). |
| [movie-reservation-system](movie-reservation-system/) | Cinema booking REST API: showtimes, timed seat holds, Stripe Checkout payments and refunds. |
| [hr-management-system](hr-management-system/) | HR platform: Spring Boot 3.5 / Java 21, PostgreSQL and a React + TypeScript frontend. |
| [ai-document-assistant](ai-document-assistant/) | Chat with a PDF: retrieval-augmented answers with page citations (Spring Boot, pgvector, Gemini, React). |
