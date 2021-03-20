import uuid

import httpx


async def ms_translate(
    text: str, lang_code: str, api_key: str, country: str = "westeurope"
) -> str:
    async with httpx.AsyncClient(timeout=None) as session:
        answer = (
            await session.post(
                "https://api.cognitive.microsofttranslator.com/translate",
                params={"api-version": "3.0", "to": [lang_code]},
                headers={
                    "Ocp-Apim-Subscription-Key": api_key,
                    "Ocp-Apim-Subscription-Region": country,
                    "Content-type": "application/json",
                    "X-ClientTraceId": str(uuid.uuid4()),
                },
                json=[{"text": text}],
            )
        ).json()
        return answer[0]["translations"][0]["text"]
