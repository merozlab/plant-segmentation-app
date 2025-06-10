---
applyTo: '**'
---
### App usage

This application is a specialized tool built on the Segment Anything Model (SAM) framework, designed specifically for plant movement analysis. The tool provides two main functions:

1. **Video Segmentation**: Process videos of plant movement to identify and segment plant structures from the background.

2. **Centerline Extraction**: Extract the central axes/centerlines from the segmented plant structures to analyze movement patterns.

To use this application:
1. Load your plant movement video
2. Configure segmentation parameters
3. Run the segmentation process
4. Extract centerlines from the segmented regions
5. Export or analyze the resulting data

### User Interface
When creating warnings, info messages or errors for the user, always use the snackbar, which is imported like `import useMessagesSnackbar from '@/common/components/snackbar/useDemoMessagesSnackbar';`, and used `const {enqueueMessage} = useMessagesSnackbar();`. The messages and options are defined here: `demo/frontend/src/common/components/snackbar/DemoMessagesSnackbarUtils.ts`, so add to here when new error is needed. Ensure to follow the existing format for consistency.

### Coding
- make sure not to leave variables declared but never read.
- use jotai rather than useState for state management. store all atoms in '@/demo/atoms'. use the `useAtom` hook to read and write atoms. use `useMemo` and `useCallback` to memoize values and functions.

### Mobile
No need to edit the mobile version, as I plan on disabling it.

### Running the application
Start the application using docker compose:

```bash
docker-compose up --build
```

Stop the application using:

```bash
docker-compose down
```