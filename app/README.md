### Installation
1. Clone this repository
2. Install the required packages via poetry
```bash
pip install -e ".[notebooks]"
```
3. Download checkpoints  
```bash
cd checkpoints && \
./download_ckpts.sh && \
cd ..

Check out INSTALL.md for more details.

Make sure you are using CUDA 12.4.
```
**To update sam2:**
```bash
git pull upstream main
```