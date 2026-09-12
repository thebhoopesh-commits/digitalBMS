import os
os.environ["OLLAMA_URL"] = "http://10.118.169.51:11434"
os.environ["OLLAMA_MODEL"] = "qwen3:1.7b"
from src.nlp.translator import translate_complaint

try:
    res = translate_complaint("hi")
    print(res)
except Exception as e:
    import traceback
    traceback.print_exc()

