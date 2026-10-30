"""
MacroMiro desk patch: let OASIS/camel agents run on Gemini's OpenAI-compatible endpoint.

Gemini 3 models return a `thought_signature` (in tool_calls[].extra_content.google) and
reject the next request with 400 "Function call is missing a thought_signature" when an
earlier assistant tool call in the history comes back without it. camel-ai 0.2.78 drops
that field when it stores the tool call, so every agent step after the first tool call fails.

Google documents a placeholder signature for histories that cannot carry the real one
(https://ai.google.dev/gemini-api/docs/thought-signatures). This shim adds it to any
assistant tool call that has no signature, only when LLM_BASE_URL points at Gemini.
Other providers are untouched.
"""
import os

SKIP_SIGNATURE = "skip_thought_signature_validator"
_installed = False


def is_gemini(base_url=None):
    url = base_url if base_url is not None else os.environ.get("LLM_BASE_URL", "")
    return "generativelanguage.googleapis.com" in (url or "")


def sign_tool_calls(messages):
    for m in messages or []:
        if not isinstance(m, dict) or m.get("role") != "assistant":
            continue
        for tc in m.get("tool_calls") or []:
            if isinstance(tc, dict):
                google = tc.setdefault("extra_content", {}).setdefault("google", {})
                google.setdefault("thought_signature", SKIP_SIGNATURE)
    return messages


def install_gemini_thought_signature_shim(base_url=None):
    """Patch camel's OpenAI model once. Returns True when the shim is active."""
    global _installed
    if not is_gemini(base_url):
        return False
    if _installed:
        return True
    from camel.models.openai_model import OpenAIModel

    orig_async = OpenAIModel._arequest_chat_completion
    orig_sync = OpenAIModel._request_chat_completion

    async def _arequest(self, messages, tools=None):
        return await orig_async(self, sign_tool_calls(messages), tools)

    def _request(self, messages, tools=None):
        return orig_sync(self, sign_tool_calls(messages), tools)

    OpenAIModel._arequest_chat_completion = _arequest
    OpenAIModel._request_chat_completion = _request
    _installed = True
    print("[gemini_compat] thought-signature shim active for Gemini tool calls")
    return True
