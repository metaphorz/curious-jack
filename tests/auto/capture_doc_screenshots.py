"""Capture screenshots for the Curious Jack LaTeX documentation.

Requires:
  - Server running at http://localhost:3456  (./start)
  - pip install selenium
  - ChromeDriver installed and on PATH

Screenshots saved to docs/ relative to the project root.
Run from the project root:
  source venv/bin/activate
  python tests/auto/capture_doc_screenshots.py
"""

import os
import time
import sys
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

BASE_URL  = "http://localhost:3456"
DOCS_DIR  = os.path.join(os.path.dirname(__file__), "..", "..", "docs")
IMAGE_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..",
                 "images", "cotan-still-life-1602", "image.jpg")
)

QUESTIONS = (
    "What does the composition and lighting tell us about the artist's technique?\n"
    "What subjects does this image connect to?"
)


def wait(driver, seconds=1.5):
    time.sleep(seconds)


def save(driver, name):
    path = os.path.join(DOCS_DIR, name)
    driver.save_screenshot(path)
    print(f"  Saved: docs/{name}")


def main():
    os.makedirs(DOCS_DIR, exist_ok=True)

    options = webdriver.ChromeOptions()
    # Run headed so the app renders properly (no --headless)
    driver = webdriver.Chrome(options=options)
    driver.set_window_size(1400, 900)

    try:
        # ------------------------------------------------------------------
        # 1. Main interface — capture the API key modal if it appears
        # ------------------------------------------------------------------
        print("1. Loading app...")
        driver.get(BASE_URL)
        wait(driver, 2)

        # Force-show the modal via JS for the screenshot regardless of server key
        driver.execute_script(
            "document.getElementById('keyModal').classList.remove('hidden');"
        )
        wait(driver, 0.5)
        save(driver, "modal.png")
        print("   Modal captured.")
        # Dismiss by hiding it again via JS (no need to submit a real key)
        driver.execute_script(
            "document.getElementById('keyModal').classList.add('hidden');"
        )
        wait(driver, 0.5)

        # ------------------------------------------------------------------
        # 2. Clean main interface
        # ------------------------------------------------------------------
        print("2. Main interface...")
        save(driver, "main.png")

        # ------------------------------------------------------------------
        # 3. Upload image and enter questions
        # ------------------------------------------------------------------
        print("3. Uploading image...")
        file_input = driver.find_element(By.ID, "imageFile")
        file_input.send_keys(IMAGE_PATH)
        wait(driver, 1.5)

        loc_input = driver.find_element(By.ID, "imageLocation")
        loc_input.clear()
        loc_input.send_keys("Museo del Prado, Madrid")

        qa = driver.find_element(By.ID, "questionsInput")
        qa.clear()
        qa.send_keys(QUESTIONS)
        wait(driver)

        save(driver, "ready.png")
        print("   Ready state captured.")

        # ------------------------------------------------------------------
        # 4. Results — only attempt if server has a real API key
        # ------------------------------------------------------------------
        print("4. Checking for real API key on server...")
        import urllib.request, json as _json
        try:
            with urllib.request.urlopen(f"{BASE_URL}/config", timeout=3) as r:
                cfg = _json.loads(r.read())
            has_key = cfg.get("hasOpenRouter", False)
        except Exception:
            has_key = False

        if has_key:
            print("   Real key found — submitting for results screenshot...")
            driver.find_element(By.ID, "submitBtn").click()
            # Wait up to 90 s for at least one answer card to appear
            try:
                WebDriverWait(driver, 90).until(
                    EC.presence_of_element_located(
                        (By.CSS_SELECTOR, ".answer-card:not(.loading)")
                    )
                )
                wait(driver, 1)
                save(driver, "results.png")
                print("   Results captured.")
            except Exception:
                print("   Timed out waiting for results — skipping results.png")
        else:
            print("   No real API key on server — skipping results.png")
            print("   (Set OPENROUTER_API_KEY in ~/.env and rerun to capture results)")

        print("\nDone. Screenshots are in docs/")

    finally:
        driver.quit()


if __name__ == "__main__":
    main()
