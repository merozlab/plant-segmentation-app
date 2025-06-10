FROM python:3.10-slim

# Environment variables
ENV APP_ROOT=/opt/sam2
ENV PYTHONUNBUFFERED=1
ENV FLASK_APP=video_app
ENV FLASK_ENV=development

# Install system requirements
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libavutil-dev \
    libavcodec-dev \
    libavformat-dev \
    libswscale-dev \
    pkg-config \
    build-essential \
    libffi-dev

# Install Python dependencies
COPY setup.py .
COPY README.md .
RUN pip install --upgrade pip setuptools
RUN pip install werkzeug==2.2.3 \
    Flask==2.2.3 \
    Flask-Cors==3.0.10 \
    requests==2.28.2 \
    av>=13.0.0 \
    dataclasses-json>=0.6.7 \
    eva-decord>=0.6.1 \
    imagesize>=1.4.1 \
    pycocotools>=2.0.8 \
    opencv-python>=4.7.0 \
    numpy>=1.24.4 \
    iopath>=0.1.10 \
    pillow>=9.4.0 \
    scipy>=1.14.1 \
    pandas>=2.0.3 \
    scikit-image>=0.25.2

# Make app directory
RUN mkdir -p ${APP_ROOT}/server

# Copy necessary files for video processing
COPY demo/backend/server/mask_to_curvature.py ${APP_ROOT}/server/
COPY demo/backend/server/app_conf.py ${APP_ROOT}/server/
COPY demo/backend/server/video_app.py ${APP_ROOT}/server/

WORKDIR ${APP_ROOT}/server

# Run Flask app
CMD ["flask", "run", "--host=0.0.0.0", "--port=5000"]
