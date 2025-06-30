import React, { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useNavigate } from "react-router-dom";

const HomePage = () => {
    const [currentSlide, setCurrentSlide] = useState(0);
    const navigate = useNavigate();
  
    const slides = [
        {
        id: 1,
        title: "STEP 1 - Select Transcription Factors",
        image: "/reCollecTF/assets/step-1-collectf.jpg",
        number: "01"
        },
        {
        id: 2,
        title: "STEP 2 - Select Species",
        image: "/reCollecTF/assets/step-2-collectf.jpg",
        number: "02"
        },
        {
        id: 3,
        title: "STEP 3 - Choose Experimental Techniques",
        image: "/reCollecTF/assets/step-3-collectf.jpg",
        number: "03"
        },
        {
        id: 4,
        title: "RESULT - Get Your Data",
        image: "/reCollecTF/assets/step-4-collectf.jpg",
        number: "04"
        }
    ];

    // Auto-advance slides every 4 seconds
    useEffect(() => {
        const timer = setInterval(() => {
        setCurrentSlide((prev) => (prev + 1) % slides.length);
        }, 4000);

        return () => clearInterval(timer);
    }, [slides.length]);

    const nextSlide = () => {
        setCurrentSlide((prev) => (prev + 1) % slides.length);
    };

    const prevSlide = () => {
        setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length);
    };

    const goToSlide = (index) => {
        setCurrentSlide(index);
    };

    return (
        <div className="flex flex-col items-center justify-center p-4">
        <h1 className="text-7xl font-bold text-accent mb-6">Welcome to CollecTF</h1>
        <p className="text-2xl text-accent mb-10">Transcription Factor Binding Site Database</p>
        
        {/* Carousel Container */}
        <div className="relative w-full max-w-4xl mx-auto">
            {/* Main carousel */}
            <div className="relative h-[40rem] rounded-xl overflow-hidden">
            {slides.map((slide, index) => (
                <div
                key={slide.id}
                className={`absolute inset-0 transition-transform duration-1000 ease-in-out ${
                    index === currentSlide 
                    ? 'translate-x-0' 
                    : index < currentSlide 
                    ? '-translate-x-full' 
                    : 'translate-x-full'
                }`}
                >
                <div className="w-full h-full bg-gradient-to-br bg-slate-700 flex items-center justify-center p-8">
                    <div className="text-center text-white max-w-2xl">
                    {/* Number circle */}
                    <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-6 backdrop-blur-sm">
                        <span className="text-2xl font-bold text-white">{slide.number}</span>
                    </div>
                    
                    <h3 className="text-2xl font-bold mb-4">{slide.title}</h3>
                    <img src={slide.image}></img>
                    </div>
                </div>
                </div>
            ))}
            
            {/* Navigation arrows */}
            <button
                onClick={prevSlide}
                className="absolute left-4 top-1/2 transform -translate-y-1/2 bg-white/10 hover:bg-white/20 rounded-full p-2 transition-colors backdrop-blur-sm"
            >
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
            </button>
            
            <button
                onClick={nextSlide}
                className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-white/10 hover:bg-white/20 rounded-full p-2 transition-colors backdrop-blur-sm"
            >
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
            </button>
            </div>

            {/* Dots indicator */}
            <div className="flex justify-center mt-6 space-x-3">
            {slides.map((_, index) => (
                <button
                key={index}
                onClick={() => goToSlide(index)}
                className={`w-3 h-3 rounded-full transition-all duration-300 ${
                    index === currentSlide 
                    ? 'bg-slate-700 scale-125' 
                    : 'bg-gray-400 hover:bg-gray-500'
                }`}
                />
            ))}
            </div>
        </div>

        {/* Action button */}
        <div className="mt-8">
            <button className="btn text-xl bg-slate-700 hover:bg-slate-800"
            onClick={ () => {navigate("/Search")}}>
            START SEARCH
            </button>
        </div>
        </div>
    );
};

export default HomePage;