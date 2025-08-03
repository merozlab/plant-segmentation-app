#!/usr/bin/env python3
"""
PyTorch Docker Image Selector for SAM-2 Plant Segmentation App

This script helps you choose the optimal PyTorch Docker base image for your system
by detecting your GPU and CUDA    if args.update:
    if args.update:
        print("🔄 Updating Dockerfile...")
        if update_dockerfile(recommended_image):
            print("✅ Dockerfile updated successfully!")
            print()
            print("Next steps:")
            print("  1. Run: docker compose build inference")
            print("  2. Run: docker compose up")
        else:
            sys.exit(1)
    else:
        print("💡 To apply this recommendation:")
        print(f"   1. Update ARG BASE_IMAGE in inference.Dockerfile to:")
        print(f"      ARG BASE_IMAGE={recommended_image}")
        print("   2. Or run this script with --update flag") print("💡 To apply this recommendation:")
        print(f"   1. Update ARG BASE_IMAGE in inference.Dockerfile to:")
        print(f"      ARG BASE_IMAGE={recommended_image}")
        print("   2. Or run this script with --update flag")t("🔄 Updating Dockerfile...")
        if update_dockerfile(recommended_image):
            print("✅ Dockerfile updated successfully!")
            print()
            print("Next steps:")
            print("  1. Run: docker compose build inference")
            print("  2. Run: docker compose up")
        else:
            sys.exit(1)
    else:
        print("💡 To apply this recommendation:")
        print(f"   1. Update ARG BASE_IMAGE in inference.Dockerfile to:")
        print(f"      ARG BASE_IMAGE={recommended_image}")
        print("   2. Or run this script with --update flag")
        print()
        print("🚀 Then rebuild and start:")
        print("   docker compose up --build")gesting the best pytorch/pytorch image.
"""
import subprocess
import sys
import os
import argparse

def get_gpu_info():
    """Detect GPU information using nvidia-ml-py with fallback to nvidia-smi."""
    gpu_info = {'has_gpu': False, 'gpu_name': 'Unknown', 'cuda_version': None, 'compute_capability': None}
    
    # Try nvidia-ml-py first
    try:
        import pynvml
        pynvml.nvmlInit()
        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        gpu_info['has_gpu'] = True
        gpu_info['gpu_name'] = pynvml.nvmlDeviceGetName(handle).decode('utf-8')
        
        # Get CUDA driver version
        try:
            driver_version = pynvml.nvmlSystemGetDriverVersion().decode('utf-8')
            # Convert driver version to CUDA version (approximate mapping)
            driver_major = int(driver_version.split('.')[0])
            if driver_major >= 550:
                gpu_info['cuda_version'] = '12.8'
            elif driver_major >= 530:
                gpu_info['cuda_version'] = '12.6'
            elif driver_major >= 515:
                gpu_info['cuda_version'] = '12.1'
            else:
                gpu_info['cuda_version'] = '11.8'
        except:
            gpu_info['cuda_version'] = '12.8'  # Default
            
        # Get compute capability
        try:
            major = pynvml.nvmlDeviceGetCudaComputeCapability(handle)[0]
            minor = pynvml.nvmlDeviceGetCudaComputeCapability(handle)[1]
            gpu_info['compute_capability'] = f"{major}.{minor}"
        except:
            pass
            
        return gpu_info
        
    except (ImportError, Exception):
        pass
    
    # Fall back to nvidia-smi
    try:
        result = subprocess.run(['nvidia-smi', '--query-gpu=gpu_name,driver_version', '--format=csv,noheader,nounits'], 
                              capture_output=True, text=True, check=True)
        lines = result.stdout.strip().split('\n')
        if lines and lines[0]:
            parts = lines[0].split(', ')
            if len(parts) >= 1:
                gpu_info['has_gpu'] = True
                gpu_info['gpu_name'] = parts[0].strip()
                
                if len(parts) >= 2:
                    driver_version = parts[1].strip()
                    # Simple driver to CUDA mapping
                    try:
                        driver_major = int(driver_version.split('.')[0])
                        if driver_major >= 550:
                            gpu_info['cuda_version'] = '12.8'
                        elif driver_major >= 530:
                            gpu_info['cuda_version'] = '12.6'
                        elif driver_major >= 515:
                            gpu_info['cuda_version'] = '12.1'
                        else:
                            gpu_info['cuda_version'] = '11.8'
                    except:
                        gpu_info['cuda_version'] = '12.8'  # Default to latest
                        
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
    
    return gpu_info

def get_recommended_image(gpu_info):
    """Get recommended PyTorch Docker image based on GPU info."""
    if not gpu_info['has_gpu']:
        return "pytorch/pytorch:2.7.1-cuda12.8-cudnn9-runtime", "CPU-only (no GPU detected)"
    
    cuda_version = gpu_info.get('cuda_version', '12.8')
    
    # Map CUDA versions to best PyTorch images
    if cuda_version.startswith('12.8') or cuda_version.startswith('12.7'):
        return "pytorch/pytorch:2.7.1-cuda12.8-cudnn9-runtime", f"CUDA {cuda_version} (latest)"
    elif cuda_version.startswith('12.6'):
        return "pytorch/pytorch:2.7.1-cuda12.6-cudnn9-runtime", f"CUDA {cuda_version}"
    elif cuda_version.startswith('12.1') or cuda_version.startswith('12.0'):
        return "pytorch/pytorch:2.7.1-cuda12.1-cudnn9-runtime", f"CUDA {cuda_version}"
    elif cuda_version.startswith('11.8'):
        return "pytorch/pytorch:2.5.1-cuda11.8-cudnn8-runtime", f"CUDA {cuda_version} (older)"
    else:
        return "pytorch/pytorch:2.7.1-cuda12.8-cudnn9-runtime", f"CUDA {cuda_version} (defaulting to latest)"

def update_dockerfile(image_name):
    """Update the inference.Dockerfile with the recommended base image."""
    dockerfile_path = "inference.Dockerfile"
    
    if not os.path.exists(dockerfile_path):
        print(f"❌ Error: {dockerfile_path} not found!")
        return False
    
    try:
        with open(dockerfile_path, 'r') as f:
            content = f.read()
        
        # Replace the ARG BASE_IMAGE line
        lines = content.split('\n')
        for i, line in enumerate(lines):
            if line.startswith('ARG BASE_IMAGE='):
                lines[i] = f'ARG BASE_IMAGE={image_name}'
                break
        else:
            print(f"❌ Error: Could not find 'ARG BASE_IMAGE=' line in {dockerfile_path}")
            return False
        
        with open(dockerfile_path, 'w') as f:
            f.write('\n'.join(lines))
        
        print(f"✅ Updated {dockerfile_path} with base image: {image_name}")
        return True
        
    except Exception as e:
        print(f"❌ Error updating {dockerfile_path}: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(
        description="Choose optimal PyTorch Docker image for SAM-2 based on your GPU",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python install_pytorch.py                    # Detect GPU and show recommendation
  python install_pytorch.py --update           # Detect GPU and update Dockerfile
  python install_pytorch.py --list             # Show all available images
  python install_pytorch.py --force cuda12.8   # Force specific CUDA version
        """
    )
    
    parser.add_argument('--update', action='store_true', 
                       help='Automatically update inference.Dockerfile with recommended image')
    parser.add_argument('--list', action='store_true',
                       help='List all available PyTorch Docker images')
    parser.add_argument('--force', metavar='CUDA_VERSION',
                       help='Force a specific CUDA version (e.g., cuda12.8, cuda12.1)')
    
    args = parser.parse_args()
    
    if args.list:
        print("🐳 Available PyTorch Docker Images for SAM-2:")
        print()
        images = [
            ("pytorch/pytorch:2.7.1-cuda12.8-cudnn9-runtime", "Latest PyTorch 2.7.1 with CUDA 12.8"),
            ("pytorch/pytorch:2.7.1-cuda12.6-cudnn9-runtime", "PyTorch 2.7.1 with CUDA 12.6"),
            ("pytorch/pytorch:2.7.1-cuda12.1-cudnn9-runtime", "PyTorch 2.7.1 with CUDA 12.1"),
            ("pytorch/pytorch:2.5.1-cuda11.8-cudnn8-runtime", "PyTorch 2.5.1 with CUDA 11.8 (older GPUs)"),
        ]
        for image, desc in images:
            print(f"  {image}")
            print(f"    {desc}")
            print()
        return
    
    print("🔍 SAM-2 PyTorch Docker Image Selector")
    print("=" * 50)
    
    if args.force:
        # Force specific CUDA version
        cuda_version = args.force.replace('cuda', '')
        fake_gpu_info = {'has_gpu': True, 'cuda_version': cuda_version}
        recommended_image, reason = get_recommended_image(fake_gpu_info)
        print(f"🔧 Forcing CUDA version: {cuda_version}")
    else:
        # Detect GPU automatically
        print("Detecting your GPU configuration...")
        gpu_info = get_gpu_info()
        
        if gpu_info['has_gpu']:
            print(f"✅ Found GPU: {gpu_info['gpu_name']}")
            if gpu_info.get('cuda_version'):
                print(f"✅ CUDA Version: {gpu_info['cuda_version']}")
            if gpu_info.get('compute_capability'):
                print(f"✅ Compute Capability: {gpu_info['compute_capability']}")
        else:
            print("⚠️  No GPU detected")
        
        recommended_image, reason = get_recommended_image(gpu_info)
    
    print()
    print("🎯 Recommendation:")
    print(f"   Base Image: {recommended_image}")
    print(f"   Reason: {reason}")
    print()
    
    if args.update:
        print("🔄 Updating Dockerfile...")
        if update_dockerfile(recommended_image):
            print("✅ Dockerfile updated successfully!")
            print()
            print("Next steps:")
            print("  1. Run: docker compose build inference")
            print("  2. Run: docker compose up")
        else:
            sys.exit(1)
    else:
        print("� To apply this recommendation:")
        print(f"   1. Update ARG BASE_IMAGE in inference.Dockerfile to:")
        print(f"      ARG BASE_IMAGE={recommended_image}")
        print("   2. Or run this script with --update flag")
        print()
        print("🚀 Then rebuild and start:")
        print("   docker compose up --build")

if __name__ == "__main__":
    main()
