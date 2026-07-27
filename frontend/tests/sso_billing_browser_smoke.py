import asyncio
import os

from playwright.async_api import async_playwright


async def main() -> None:
    base_url = os.environ.get("BASE_URL", "http://127.0.0.1:3011")
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        try:
            page = await browser.new_page(viewport={"width": 1440, "height": 900})
            response = await page.goto(f"{base_url}/login", wait_until="networkidle")
            assert response is not None and response.ok
            await page.screenshot(path="/tmp/sso-billing-smoke.png", full_page=True)

            payload = {
                "action": "reserve",
                "product": "xhstw",
                "userId": "smoke-test-user",
                "requestId": "f4e7799e-a07e-4a29-93f2-410d45bd2e56",
                "operation": "browser-smoke",
                "model": "deepseek-v4-flash",
                "estimatedInputTokens": 100,
                "maxOutputTokens": 100,
            }
            unauthorized = await page.request.post(
                f"{base_url}/api/sso/billing",
                data=payload,
                headers={"x-qycm-sso-client-secret": "wrong-secret"},
            )
            assert unauthorized.status == 401
            unauthorized_body = await unauthorized.json()
            assert unauthorized_body.get("code") == "SSO_BILLING_CLIENT_UNAUTHORIZED"

            unknown = await page.request.post(
                f"{base_url}/api/sso/billing",
                data={**payload, "product": "unknown-tool"},
            )
            assert unknown.status == 404
            unknown_body = await unknown.json()
            assert unknown_body.get("code") == "EXTERNAL_SSO_PRODUCT_INVALID"
        finally:
            await browser.close()


asyncio.run(main())
