/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  moduleNameMapper: {
    '^@alliva/types$': '<rootDir>/../../packages/types/src/index.ts',
    '^@alliva/validation$': '<rootDir>/../../packages/validation/src/index.ts',
  },
  transformIgnorePatterns: ['/node_modules/(?!(@nestjs)/)'],
  setupFiles: ['<rootDir>/src/load-env.ts'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/test/'],
};
