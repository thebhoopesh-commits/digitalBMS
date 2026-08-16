import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import uvicorn
from dotenv import load_dotenv

load_dotenv() # Load variables from .env file

from src.api.routes import router
from src.api.coordinator import SimulationCoordinator

def create_app(coordinator: SimulationCoordinator = None) -> FastAPI:
    """Factory to create and configure the FastAPI application."""
    app = FastAPI(title="Digital Twin HVAC Optimizer API")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(router)

    # Mount UI static files
    ui_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "ui")
    if os.path.exists(ui_path):
        app.mount("/static", StaticFiles(directory=ui_path), name="static")

        @app.get("/")
        async def serve_index():
            return FileResponse(os.path.join(ui_path, "index.html"))

    # Initialize and attach coordinator
    coord = coordinator or SimulationCoordinator(
        llm_api_key=os.getenv("OPENAI_API_KEY") or os.getenv("GEMINI_API_KEY")
    )
    if not coord.is_initialized():
        coord.initialize()

    app.state.coordinator = coord

    @app.on_event("shutdown")
    def shutdown_event():
        if hasattr(app.state, "coordinator"):
            app.state.coordinator.shutdown()

    return app

app = create_app()

if __name__ == "__main__":
    uvicorn.run("src.api.server:app", host="0.0.0.0", port=8000, reload=True)
