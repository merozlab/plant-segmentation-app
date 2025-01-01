import queue
import threading
import time
from helpers import create_tagged_frame
import shutil
from datetime import datetime


# A "job" might be a dict with user data, plus a way to store results.
class Job:
    def __init__(self, job_id, input_data):
        self.job_id = job_id
        self.input_data = input_data
        self.result = None
        self.done = threading.Event()  # to signal when processing is finished


# Create a global queue to hold jobs
job_queue = queue.Queue()
job_positions = {}  # Dictionary to keep track of job positions
queue_lock = threading.Lock()  # Lock to safely update job_positions


def worker():
    """Continuously process jobs from the queue."""
    while True:
        job = job_queue.get()  # blocks until a job is available

        # Run your Sam2 inference here:
        result = run_sam2_inference(**job.input_data)

        # Store result and signal completion
        job.result = result
        job.done.set()

        # Update job positions after processing
        with queue_lock:
            del job_positions[job.job_id]  # Remove completed job

        # Mark the queue task as done
        job_queue.task_done()


def run_sam2_inference(video_dir, predictor, inference_state, annotations, frame_names):
    video_segments = {}  # video_segments contains the per-frame segmentation results
    for (
        out_frame_idx,
        out_obj_ids,
        out_mask_logits,
    ) in predictor.propagate_in_video(inference_state):
        (video_dir / "masks").mkdir(exist_ok=True)
        for ooid in out_obj_ids:
            save_dir = video_dir / "masks" / f"object_{ooid}"
            save_dir.mkdir(exist_ok=True)
        video_segments[out_frame_idx] = {
            out_obj_id: (out_mask_logits[i] > 0.0).cpu().numpy()
            for i, out_obj_id in enumerate(out_obj_ids)
        }

        for out_obj_id, mask in video_segments[out_frame_idx].items():
            create_tagged_frame(
                video_dir,
                frame_names[out_frame_idx],
                {
                    k: v
                    for k, v in video_segments[out_frame_idx].items()
                    if k == out_obj_id
                },
                annotations=annotations,
                save=True,
                save_dir=video_dir / "masks" / f"object_{out_obj_id}",
                bw=True,
                display=False,
            )
        shutil.make_archive(str(video_dir / "masks"), "zip", str(video_dir / "masks"))
    return "Done"


def get_queue_position(job_id):
    """Return the position of a job in the queue."""
    with queue_lock:
        if job_id in job_positions:
            return job_positions[job_id]
        return None


def update_job_positions():
    """Update the job positions for all jobs in the queue."""
    with queue_lock:
        for index, job_id in enumerate(list(job_positions.keys()), start=1):
            job_positions[job_id] = index


# Example of adding a job
def add_job(job_id, input_data):
    """Add a new job to the queue using a provided UUID."""
    new_job = Job(job_id=job_id, input_data=input_data)

    with queue_lock:
        job_positions[job_id] = len(job_positions) + 1  # Add new job at the end

    job_queue.put(new_job)
    update_job_positions()  # Update positions after adding the job

    return new_job


# Start worker thread (only 1 worker to avoid concurrency issues)
threading.Thread(target=worker, daemon=True).start()
