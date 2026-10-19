# Wall detector for a free Hugging Face Docker Space (CPU, 16 GB RAM, port 7860).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Spaces run as uid 1000
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH
WORKDIR /home/user/app

COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt

# bake the OCR weights in so the first request is not slow
RUN python -c "import easyocr; easyocr.Reader(['en'], gpu=False, verbose=False)"

COPY --chown=user . .
ENV MODEL_PATH=/home/user/app/models/best.pt OUTPUT_DIR=/tmp/output

EXPOSE 7860
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
