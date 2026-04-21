FROM python:3.12-alpine

WORKDIR /app

COPY health-server.py /app/health-server.py

ENV PYTHONUNBUFFERED=1
ENV APP_BIND_HOST=0.0.0.0
ENV APP_PORT=3000
ENV APP_HEALTH_PATH=/healthz

EXPOSE 3000

CMD ["python", "/app/health-server.py"]
