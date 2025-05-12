# Local Deployment Mode

This application includes a feature flag called "Local Deployment Mode" that enables functionality specific to local development environments, such as processing image folders directly from the local file system.

## Features Enabled in Local Deployment Mode

When the local deployment mode is enabled:

1. The UI will show an additional option to process a folder of images from the local file system
2. The backend will expose an endpoint `/process_local_folder` that can process local folders

## Toggling Local Deployment Mode

### Frontend Configuration

To toggle the local deployment mode in the frontend:

1. Open the file `frontend/src/demo/DemoConfig.tsx`
2. Find the `IS_LOCAL_DEPLOYMENT` constant:

```typescript
/**
 * IS_LOCAL_DEPLOYMENT
 * Set to true for local development environments where you want to enable
 * features like local folder processing.
 * Set to false for production/remote deployments where local file system 
 * access is not available or should be disabled for security reasons.
 */
export const IS_LOCAL_DEPLOYMENT = true;
```

3. Set it to `true` to enable local deployment features, or `false` to disable them.

### Backend Configuration

To toggle the local deployment mode in the backend:

1. Option 1: Environment Variable
   - Set the environment variable `IS_LOCAL_DEPLOYMENT` to "true" or "false"

2. Option 2: Update app_conf.py
   - Open the file `backend/server/app_conf.py`
   - Find the `IS_LOCAL_DEPLOYMENT` line:
   ```python
   # Set to "true" for local development, "false" for production
   IS_LOCAL_DEPLOYMENT = os.getenv("IS_LOCAL_DEPLOYMENT", "true").lower() == "true"
   ```
   - Change the default value from "true" to "false" to disable local deployment features

## Best Practices

- Always disable local deployment mode in production environments
- Local deployment mode should only be enabled for development and testing
- When deploying to a server or cloud environment, ensure `IS_LOCAL_DEPLOYMENT` is set to false for security reasons

## How to Use Local Folder Processing

When local deployment mode is enabled:

1. Create a folder with images inside the uploads directory (configured in `frontend/src/demo/DemoConfig.tsx` as `UPLOADS_DIRECTORY`)
2. Enter the folder name in the input field 
3. Click "Process Folder"
4. The app will convert all images in the folder to a video and load it into the application

## Configuration

The path to the uploads directory is defined in `frontend/src/demo/DemoConfig.tsx` as `UPLOADS_DIRECTORY`. 
If your server's uploads directory is in a different location, make sure to update this variable accordingly.
