import React from 'react';
import Head from 'next/head';

export default function Home() {
  return (
    <>
      <Head>
        <title>Smart Tourist Safety - Admin Dashboard</title>
        <meta name="description" content="Admin dashboard for Smart Tourist Safety Monitoring System" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <main className="min-h-screen bg-gray-100">
        <div className="container mx-auto px-4 py-8">
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <h1 className="text-4xl font-bold text-gray-900 mb-4">
              Smart Tourist Safety
            </h1>
            <h2 className="text-2xl text-gray-600 mb-8">
              Admin Dashboard
            </h2>
            <p className="text-gray-600">
              Welcome to the Smart Tourist Safety Monitoring System admin panel.
            </p>
          </div>
        </div>
      </main>
    </>
  );
}