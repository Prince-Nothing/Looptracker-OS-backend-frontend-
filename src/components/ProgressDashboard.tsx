'use client';

import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useAppContext } from '@/context/AppContext';
import { API_URL } from '@/lib/api';

type DiagnosticHistoryPoint = {
    timestamp: string;
    diagnostics: {
        MIIS?: number;
        SRQ?: number;
        EFM?: number;
    }
}

export default function ProgressDashboard() {
    const { authToken } = useAppContext();
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchDiagnosticHistory = async () => {
            if (!authToken) return;
            setLoading(true);
            setError(null);
            try {
                const response = await fetch(`${API_URL}/users/me/diagnostics`, {
                    headers: { 'Authorization': `Bearer ${authToken}` },
                });
                if (!response.ok) {
                    throw new Error('Failed to fetch diagnostic data.');
                }
                const history: DiagnosticHistoryPoint[] = await response.json();
                
                // Format data for Recharts
                const formattedData = history.map(point => ({
                    name: new Date(point.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                    MIIS: point.diagnostics.MIIS,
                    SRQ: point.diagnostics.SRQ,
                    EFM: point.diagnostics.EFM,
                }));
                setData(formattedData);

            } catch (err) {
                setError(err instanceof Error ? err.message : 'An unknown error occurred.');
            } finally {
                setLoading(false);
            }
        };

        fetchDiagnosticHistory();
    }, [authToken]);

    if (loading) {
        return <div className="flex items-center justify-center h-full text-gray-400">Loading Progress Data...</div>;
    }

    if (error) {
        return <div className="flex items-center justify-center h-full text-red-400">Error: {error}</div>;
    }

    return (
        <div className="flex-1 flex flex-col p-6 bg-gray-900">
            <h1 className="text-2xl font-bold mb-6">Your Progress Over Time</h1>
            
            {data.length > 0 ? (
                <div className="bg-gray-800 p-6 rounded-lg flex-1">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                            data={data}
                            margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
                        >
                            <CartesianGrid strokeDasharray="3 3" stroke="#4A5568" />
                            <XAxis dataKey="name" stroke="#A0AEC0" />
                            <YAxis stroke="#A0AEC0" domain={[0, 10]} />
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: '#2D3748',
                                    border: '1px solid #4A5568',
                                    color: '#E2E8F0'
                                }}
                            />
                            <Legend wrapperStyle={{ color: '#E2E8F0' }} />
                            <Line type="monotone" dataKey="MIIS" stroke="#8884d8" strokeWidth={2} name="Metacognitive Integrity" />
                            <Line type="monotone" dataKey="SRQ" stroke="#82ca9d" strokeWidth={2} name="Self-Regulation" />
                            <Line type="monotone" dataKey="EFM" stroke="#ffc658" strokeWidth={2} name="Emotional Fluidity" />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            ) : (
                <div className="flex items-center justify-center h-full bg-gray-800 rounded-lg">
                    <p className="text-gray-400">No diagnostic data available yet. Start a conversation to see your progress!</p>
                </div>
            )}
        </div>
    );
}