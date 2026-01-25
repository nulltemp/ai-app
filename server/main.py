from fastapi import FastAPI, Request, HTTPException
import json
import ollama

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
    Forward the request messages to the Ollama service using the ollama library
    and return only the message content.
    """
    try:
        # Get the request body as JSON
        body = await request.json()
        messages = body.get("messages", [])

        # Call Ollama chat
        # Note: host defaults to localhost:11434 or OLLAMA_HOST environment variable.
        # If running in Docker with another container named 'ollama', 
        # ensure OLLAMA_HOST=http://ollama:11434 is set in the environment.
        client = ollama.AsyncClient(host="http://ollama:11434")
        response = await client.chat(
            model="gemma3:270m",
            messages=messages,
        )

        # Return only the message part
        return response["message"]

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error forwarding request to Ollama: {str(e)}")
