import { Analyzer } from '../src/analyzer';

function assert(condition: boolean, message: string) {
    if (!condition) {
        throw new Error(message);
    }
}

try {
    console.log('Testing Mean...');
    assert(Analyzer.calculateMean([1, 2, 3, 4, 5]) === 3, 'Mean failed');

    console.log('Testing Variance & StdDev...');
    const variance = Analyzer.calculateVariance([1, 2, 3, 4, 5], 3);
    assert(variance === 2, 'Variance failed');
    assert(Analyzer.calculateStandardDeviation(variance) === Math.sqrt(2), 'StdDev failed');

    console.log('Testing Z-Score...');
    assert(Analyzer.calculateZScore(5, 3, Math.sqrt(2)) > 1.4, 'Z-Score failed');

    console.log('All tests passed!');
} catch (error) {
    console.error('Test Failed:', error);
    process.exit(1);
}
