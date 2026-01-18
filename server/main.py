from fastapi import FastAPI, Request
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
