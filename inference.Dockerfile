ARG BASE_IMAGE=pytorch/pytorch:2.7.1-cuda12.8-cudnn9-runtime

ARG MODEL_SIZE=base_plus

FROM ${BASE_IMAGE}

# Gunicorn environment variables
ENV GUNICORN_WORKERS=1
ENV GUNICORN_THREADS=2
ENV GUNICORN_PORT=5000

# SAM 2 environment variables
ENV APP_ROOT=/opt/sam2
ENV PYTHONUNBUFFERED=1
ENV MODEL_SIZE=${MODEL_SIZE}

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

COPY setup.py .
COPY README.md .

RUN pip install --upgrade pip setuptools

# Copy SAM 2 source code first (needed for CUDA extension build)
COPY sam2 ./sam2

# Install SAM2 with CUDA extensions (PyTorch is already available in base image)
ENV SAM2_BUILD_CUDA=1
RUN pip install -e .
RUN python setup.py build_ext

# Step 4: Install additional demo requirements (avoiding duplicates with SAM2 setup.py)
RUN pip install \
    # Web server and API
    Flask>=3.0.3 \
    Flask-Cors>=5.0.0 \
    gunicorn>=23.0.0 \
    strawberry-graphql>=0.243.0 \
    # Video processing (not in SAM2)
    av>=13.0.0 \
    eva-decord>=0.6.1 \
    imagesize>=1.4.1 \
    dataclasses-json>=0.6.7 \ 
    pycocotools>=2.0.8 

# https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite/issues/69#issuecomment-1826764707
# Check if ffmpeg exists before removing it and create symlink
RUN if [ -f /opt/conda/bin/ffmpeg ]; then rm /opt/conda/bin/ffmpeg; fi && ln -sf /bin/ffmpeg /opt/conda/bin/ffmpeg

# Make app directory. This directory will host all files required for the
# backend and SAM 2 inference files.
RUN mkdir -p ${APP_ROOT}/server

# Copy backend server files for inference service
COPY demo/backend/server/app_conf.py ${APP_ROOT}/server/
COPY demo/backend/server/resolution_config.py ${APP_ROOT}/server/
COPY demo/backend/server/data ${APP_ROOT}/server/data
COPY demo/backend/server/inference ${APP_ROOT}/server/inference
COPY demo/backend/server/inference_app.py ${APP_ROOT}/server/

# Download SAM 2.1 checkpoints
ADD https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt ${APP_ROOT}/checkpoints/sam2.1_hiera_tiny.pt
ADD https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt ${APP_ROOT}/checkpoints/sam2.1_hiera_small.pt
ADD https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt ${APP_ROOT}/checkpoints/sam2.1_hiera_base_plus.pt
ADD https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt ${APP_ROOT}/checkpoints/sam2.1_hiera_large.pt

WORKDIR ${APP_ROOT}/server

# https://pythonspeed.com/articles/gunicorn-in-docker/
CMD gunicorn --worker-tmp-dir /dev/shm \
    --worker-class gthread inference_app:app \
    --log-level info \
    --access-logfile /dev/stdout \
    --log-file /dev/stderr \
    --workers ${GUNICORN_WORKERS} \
    --threads ${GUNICORN_THREADS} \
    --bind 0.0.0.0:${GUNICORN_PORT} \
    --timeout 60
