from fastapi import FastAPI, Request, HTTPException
import httpx
import json

app = FastAPI()

@app.get("/")
def read_root():
    return {"hello": "world"}

@app.post("/echo")
async def echo_string(request: Request):
    # Get the raw body content
    body = await request.body()
    # Return the body as-is
    return body

@app.post("/ollama")
async def forward_to_ollama(request: Request):
    """
    Forward the request body to the Ollama service running in Docker
    and return the response as-is.
    """
    try:
        # Get the raw request body
        body = await request.body()

        # Forward the request to Ollama service
        # Ollama typically runs on port 11434 in the Docker container
        ollama_url = "http://ollama:11434/api/generate"

        # Create async HTTP client and forward the request
        async with httpx.AsyncClient() as client:
            # Forward the request with the same body
            response = await client.post(ollama_url, content=body)

            # Return the response from Ollama as-is
            return response.content

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error forwarding request to Ollama: {str(e)}")
