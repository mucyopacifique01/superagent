# Project memory

## Product intent & audience

- AI-powered chat assistant web application built on Vite + React.
- Supports two interaction modes:
  - **Fast mode:** general questions, explanations, coding help, normal conversation via Groq.
  - **Advanced mode:** longer research, planning, architecture, business analysis, multi-step tasks via CrewAI.
- Target audience: users needing both quick answers and deeper research/workflow capabilities.

## Brand personality & voice

- Production-grade, polished, non-generic aesthetic expected.
- Assistant responses are clear, technical, and informative.

## Visual design & UX direction

- Full-featured chat interface implied; must be production-worthy.
- Tech stack constraints inform UI: Tailwind CSS for styling, Lucide React for icons, React hooks for state.

## Decisions, constraints & rationale

- Environment secrets configured: `GROQ_API_KEY`, `CREWAI_URL`, `CREWAI_TOKEN`.
- Both Groq and CrewAI modes are available and functional.
- The AI is **not** an unrestricted agent — cannot send emails, browse the internet, edit files, execute code, or call new services unless those tools are specifically connected to the CrewAI service.
- Path alias `@/` maps to `src/` for module imports.

## Open questions & assumptions

- Exact UI/UX layout for chat interface and mode selection not yet specified.
- Whether mode (fast vs. advanced) is user-selected or auto-determined is unclear.
- Specific tools/integrations connected to CrewAI beyond defaults are unknown.
- Deployment target and environment details (hosting, CI/CD) not yet discussed.