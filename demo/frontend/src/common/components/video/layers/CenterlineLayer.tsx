// filepath: .../CenterlineLayer.tsx
import { useAtomValue } from 'jotai';
import { frameIndexAtom, centerlinesAtom } from '@/demo/atoms';
import useVideo from '../editor/useVideo';
import { useTransformContext } from 'react-zoom-pan-pinch';
import stylex from '@stylexjs/stylex';

const styles = stylex.create({
    container: {
        position: 'absolute',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
    },
});


export function CenterlineLayer() {
    const video = useVideo();
    const canvas = video?.getCanvas();
    const frameIndex = useAtomValue(frameIndexAtom);
    const centerlinesMap = useAtomValue(centerlinesAtom);
    // Gather all tracklets' centerlines for current frame
    const { transformState } = useTransformContext();

    const width = canvas?.width ?? 1;
    const height = canvas?.height ?? 1;

    // Gather all centerlines at this frame
    const allCenterlines: Array<[number, number][]> = [];
    Object.values(centerlinesMap).forEach(framesMap => {
        const cl = framesMap[frameIndex];
        if (cl && cl.length > 0) {
            allCenterlines.push(cl);
        }
    });

    return (
        <svg
            {...stylex.props(styles.container)}
            xmlns="http://www.w3.org/2000/svg"
            viewBox={`0 0 ${width} ${height}`}
        >
            {allCenterlines.flatMap((cl, objIdx) =>
                cl.map(([x, y], ptIdx) => (
                    <circle
                        key={`${objIdx}-${ptIdx}`}
                        cx={x}
                        cy={y}
                        r={1 / (transformState.scale || 1)}
                        fill="yellow"
                    />
                ))
            )}
        </svg>
    );
}
