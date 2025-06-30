import React from "react";
import { useNavigate } from "react-router-dom";

const StepProgressBar = ({ step, selectedData }) => {
    const labels = ["STEP 1", "STEP 2", "STEP 3", "RESULTS"];
    const selectedshownLimits = [60, 20, 10];
    const tooltips = [
        "Select Transcription Factors",
        "Select Species",
        "Select Experimental Techniques",
        "Show Results",
    ];

    const navigate = useNavigate();
    

    return (
        <div className="w-full">
        {/* Labels + Tooltips */}
        <div className="flex justify-between mb-2">
            {labels.map((label, i) => {
                let dataToShow = [];
                if (i === 0) dataToShow = selectedData.TF;
                if (i === 1) dataToShow = selectedData.Species;
                if (i === 2) dataToShow = selectedData.Techniques;
                
                return (
                    <div key={i} className="flex-1 text-center relative group cursor-pointer" onClick={() => navigate(`/Search/${i+1}`)}>
                        {/* Tooltip */}
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-xs bg-gray-800 text-white px-2 py-1 rounded shadow z-10 whitespace-nowrap">
                            {tooltips[i]}
                        </div>

                        {/* Label */}
                        <span
                            className={`text-sm transition-colors duration-300 ${
                                step === i + 1
                                ? "text-blue-600 font-semibold"
                                : "text-gray-400"
                            }`}
                        >
                            {`${label} `}
                        </span>
                        {/* Selected Data */}
                        {dataToShow && Array.isArray(dataToShow) && dataToShow.length > 0 && (
                        <div className="mt-1 text-xs text-gray-500">
                            {dataToShow.slice(0, selectedshownLimits[i]).map((item, idx) => (
                            <span key={item.id || idx}>
                                {item.name}
                                {idx < Math.min(dataToShow.length, selectedshownLimits[i]) - 1 ? ', ' : ''}
                            </span>
                            ))}
                            {dataToShow.length > selectedshownLimits[i] && (
                            <span><strong>{` and ${dataToShow.length - selectedshownLimits[i]} more`}</strong></span>
                            )}
                        </div>
                        )}
                    </div>
                );
            })}
        </div>

        {/* Progress Line */}
        <div className="flex w-full h-2 rounded-full overflow-hidden">
            {[1, 2, 3, 4].map((i) => (
            <div
                key={i}
                className={`flex-1 transition-colors duration-300 ${
                step >= i ? "bg-blue-800" : "bg-gray-300"
                }`}
            />
            ))}
        </div>
        </div>
    );
};

export default StepProgressBar;
