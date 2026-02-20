"""Test AI image upscaling via Nano Banana Pro (gemini-3-pro-image-preview).

Sends an existing session image to the Gemini image model via OpenRouter
with a 4x upscaling prompt, saves the result, and reports dimensions and
file size before/after.

Run from the project root:
  source venv/bin/activate
  python tests/auto/test_upscale.py

Requires OPENROUTER_API_KEY in environment or ~/.env
"""

import os
import sys
import base64
import json
import requests
from PIL import Image
import io

# Load ~/.env if present
env_path = os.path.expanduser("~/.env")
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

API_KEY   = os.environ.get("OPENROUTER_API_KEY", "")
MODEL     = "google/gemini-3-pro-image-preview"
BASE_URL  = "https://openrouter.ai/api/v1/chat/completions"
PROJECT   = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
IMAGE_IN  = os.path.join(PROJECT, "images", "cotan-still-life-1602", "image.jpg")
OUTPUT_DIR = os.path.join(PROJECT, "outputs")
IMAGE_OUT = os.path.join(OUTPUT_DIR, "upscaled-cotan.jpg")
LOG_FILE  = os.path.join(PROJECT, "tests", "auto", "upscale_test.log")

os.makedirs(OUTPUT_DIR, exist_ok=True)

def log(msg):
    print(msg)
    with open(LOG_FILE, "a") as f:
        f.write(msg + "\n")

def image_to_data_url(path):
    with open(path, "rb") as f:
        data = f.read()
    ext = os.path.splitext(path)[1].lstrip(".").lower()
    mime = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}"
    b64 = base64.b64encode(data).decode()
    return f"data:{mime};base64,{b64}", len(data)

def extract_image_from_response(data):
    """Pull the generated image URL/data from the OpenRouter response."""
    msg = data.get("choices", [{}])[0].get("message", {})
    # Gemini via OpenRouter: images in message.images[]
    if msg.get("images"):
        url = msg["images"][0].get("image_url", {}).get("url", "")
        if url:
            return url
    # Fallback: content array with image_url parts
    if isinstance(msg.get("content"), list):
        for part in msg["content"]:
            if part.get("type") == "image_url":
                return part["image_url"]["url"]
    return None

def data_url_to_bytes(data_url):
    header, b64 = data_url.split(",", 1)
    return base64.b64decode(b64)

def main():
    open(LOG_FILE, "w").close()  # clear log
    log("=== Nano Banana Pro Upscale Test ===\n")

    if not API_KEY:
        log("ERROR: OPENROUTER_API_KEY not set.")
        sys.exit(1)

    if not os.path.exists(IMAGE_IN):
        log(f"ERROR: Input image not found: {IMAGE_IN}")
        sys.exit(1)

    # --- Original image info ---
    data_url, orig_bytes = image_to_data_url(IMAGE_IN)
    orig_img = Image.open(IMAGE_IN)
    log(f"Input : {IMAGE_IN}")
    log(f"  Size    : {orig_img.width} × {orig_img.height} px")
    log(f"  File    : {orig_bytes / 1024:.1f} KB\n")

    # --- Call Nano Banana Pro ---
    prompt = (
        "Upscale this image to 4x its original resolution. "
        "Preserve all original content, colors, composition, and fine details exactly. "
        "Increase sharpness and recover hidden texture. "
        "Do not add, remove, or alter any elements."
    )

    log(f"Calling {MODEL} via OpenRouter...")
    payload = {
        "model": MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": data_url}},
                    {"type": "text", "text": prompt},
                ],
            }
        ],
    }

    resp = requests.post(
        BASE_URL,
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:3456",
            "X-Title": "Curious Jack Upscale Test",
        },
        json=payload,
        timeout=120,
    )

    log(f"HTTP status: {resp.status_code}")
    if not resp.ok:
        log(f"ERROR: {resp.text[:500]}")
        sys.exit(1)

    data = resp.json()
    log(f"Raw response (truncated):\n{json.dumps(data, indent=2)[:1000]}\n")

    # --- Extract result image ---
    img_url = extract_image_from_response(data)
    if not img_url:
        log("ERROR: No image found in response.")
        log("Full response:")
        log(json.dumps(data, indent=2))
        sys.exit(1)

    # Decode and save
    if img_url.startswith("data:"):
        img_bytes = data_url_to_bytes(img_url)
    else:
        img_bytes = requests.get(img_url, timeout=30).content

    with open(IMAGE_OUT, "wb") as f:
        f.write(img_bytes)

    result_img = Image.open(io.BytesIO(img_bytes))
    log(f"Output: {IMAGE_OUT}")
    log(f"  Size    : {result_img.width} × {result_img.height} px")
    log(f"  File    : {len(img_bytes) / 1024:.1f} KB")
    log(f"\nScale achieved: {result_img.width / orig_img.width:.2f}x width, "
        f"{result_img.height / orig_img.height:.2f}x height")
    log("\nTest complete.")

if __name__ == "__main__":
    main()
