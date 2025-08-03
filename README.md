# SAP: Segment Any Plant

**By Alex Abbey, as part of master's thesis in [Meroz Lab](https://www.merozlab.com/). Based on work by [AI at Meta, FAIR](https://ai.meta.com/research/)**


## Easy installation
Prerequisistes
1. **Docker**: Install Docker and Docker Compose for containerized deployment. See [Docker Desktop](https://www.docker.com/products/docker-desktop/)
2. **GPU with CUDA support**: Required for optimal SAM 2 performance and inference
3. **Python 3.8+**: Optional, for running the PyTorch installation script

**Verify GPU and CUDA setup:**
```bash
# Check if NVIDIA GPU is detected
nvidia-smi

# Verify Docker can access GPU
docker run --rm --gpus all nvidia/cuda:11.0-base-ubuntu20.04 nvidia-smi
```

**Install SAP**
1. Run `python install_pytorch.py --update` or manually select the right CUDA/Pytorch image in inference.Dockerfile
2. run `docker compose up --build`
3. open your browser at http://localhost:7262

## Docker Setup with Optimal PyTorch Image

For users running SAP in Docker containers, you can optimize performance by choosing the best PyTorch base image for your GPU. The `install_pytorch.py` script helps you select the optimal Docker image based on your system's GPU and CUDA version.

### Quick Start

1. **Detect your optimal PyTorch image:**
   ```bash
   python install_pytorch.py
   ```

2. **Automatically update the Dockerfile:**
   ```bash
   python install_pytorch.py --update
   ```

3. **Build and run with optimized image:**
   ```bash
   docker compose up --build
   ```

### Advanced Usage

- **List all available PyTorch images:**
  ```bash
  python install_pytorch.py --list
  ```

- **Force a specific CUDA version:**
  ```bash
  python install_pytorch.py --force cuda12.8 --update
  ```

## License

The SAM 2 model checkpoints, SAM 2 demo code (front-end and back-end), and SAM 2 training code are licensed under [Apache 2.0](./LICENSE), however the [Inter Font](https://github.com/rsms/inter?tab=OFL-1.1-1-ov-file) and [Noto Color Emoji](https://github.com/googlefonts/noto-emoji) used in the SAM 2 demo code are made available under the [SIL Open Font License, version 1.1](https://openfontlicense.org/open-font-license-official-text/).

