#!/usr/bin/env node

/**
 * Test runner for MoeDownloader AniList integration
 */

const path = require('path');
const { runAniListIntegrationTests } = require('./anilist-integration-test');
const { runDownloadPauseResumeTests } = require('./download-pause-resume-test');

async function runAllTests() {
  console.log('🚀 MoeDownloader AniList Integration Test Suite');
  console.log('================================================\n');

  const results = [];

  try {
    // Run AniList integration tests
    console.log('Running AniList Integration Tests...\n');
    const anilistResults = await runAniListIntegrationTests();
    results.push({ name: 'AniList Integration', ...anilistResults });

    // Run Download Pause/Resume tests
    console.log('\nRunning Download Pause/Resume Tests...\n');
    const pauseResumeResults = await runDownloadPauseResumeTests();
    results.push({ name: 'Download Pause/Resume', ...pauseResumeResults });

    // Summary of all test suites
    console.log('\n' + '='.repeat(50));
    console.log('OVERALL TEST SUMMARY');
    console.log('='.repeat(50));

    let totalPassed = 0;
    let totalTests = 0;

    for (const result of results) {
      totalPassed += result.passed;
      totalTests += result.total;
      
      const status = result.success ? '✅' : '❌';
      console.log(`${status} ${result.name}: ${result.passed}/${result.total} (${((result.passed / result.total) * 100).toFixed(1)}%)`);
    }

    console.log('-'.repeat(50));
    console.log(`Total: ${totalPassed}/${totalTests} tests passed (${((totalPassed / totalTests) * 100).toFixed(1)}%)`);

    if (totalPassed === totalTests) {
      console.log('\n🎉 All tests passed! The AniList integration is ready for use.');
      process.exit(0);
    } else {
      console.log('\n⚠️  Some tests failed. Please review the implementation before deploying.');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Test suite failed with error:', error);
    process.exit(1);
  }
}

// Handle command line arguments
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
MoeDownloader Test Runner

Usage: node run-tests.js [options]

Options:
  --help, -h     Show this help message
  --verbose, -v  Enable verbose output

Test Suites:
  - AniList Integration Tests
    - Anime Relations Parser
    - Filename Parser (Anitomy port)
    - AniList API Service
    - Integration Scenarios
    - Edge Cases
  - Download Pause/Resume Tests
    - Basic pause/resume functionality
    - Error handling for invalid operations

Examples:
  node run-tests.js              # Run all tests
  node run-tests.js --verbose    # Run with verbose output
`);
  process.exit(0);
}

// Run the tests
runAllTests();
