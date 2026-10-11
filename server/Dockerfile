FROM python:3.12-slim

WORKDIR /app

# 先装依赖再拷代码，充分利用 Docker 层缓存
RUN pip install --no-cache-dir "fastapi[standard]>=0.141.1" "openai>=3.19.2" "python-dotenv>=1.2.3" "asyncpg>=0.32.0" "bcrypt>=4.2.0" "pyjwt>=2.8.0"

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
