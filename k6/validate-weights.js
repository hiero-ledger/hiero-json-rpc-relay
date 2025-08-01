// Test script for traffic weights validation
import { trafficWeights, calculateVUAllocation } from './src/lib/traffic-weights.js';

console.log('=== Traffic Weights Validation ===');
console.log('Total endpoints:', Object.keys(trafficWeights).length);

const totalWeight = Object.values(trafficWeights).reduce((sum, weight) => sum + weight, 0);
console.log('Total weight sum:', totalWeight.toFixed(6));

console.log('\n=== VU Allocation Test (DEFAULT_VUS=100) ===');
const allocation100 = calculateVUAllocation(100);
const allocatedVUs = Object.values(allocation100).reduce((sum, vus) => sum + vus, 0);
console.log('Total VUs allocated:', allocatedVUs);

console.log('\nTop 10 endpoints by VU allocation:');
Object.entries(allocation100)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .forEach(([endpoint, vus]) => {
    const percentage = (trafficWeights[endpoint] * 100).toFixed(2);
    console.log(`  ${endpoint}: ${vus} VUs (${percentage}%)`);
  });

console.log('\n=== VU Allocation Test (DEFAULT_VUS=50) ===');
const allocation50 = calculateVUAllocation(50);
const allocatedVUs50 = Object.values(allocation50).reduce((sum, vus) => sum + vus, 0);
console.log('Total VUs allocated:', allocatedVUs50);

console.log('\nTop 5 endpoints with 50 VUs:');
Object.entries(allocation50)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .forEach(([endpoint, vus]) => {
    const percentage = (trafficWeights[endpoint] * 100).toFixed(2);
    console.log(`  ${endpoint}: ${vus} VUs (${percentage}%)`);
  });

console.log('\n All endpoints with 100 VUs:');
Object.entries(allocation100)
  .sort((a, b) => b[1] - a[1])
  .forEach(([endpoint, vus]) => {
    const percentage = (trafficWeights[endpoint] * 100).toFixed(2);
    console.log(`  ${endpoint}: ${vus} VUs (${percentage}%)`);
  });
