cmake_minimum_required(VERSION 3.15)
project(SankeyDecoder LANGUAGES CXX)

# C++17 standard required for nlohmann/json
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Fetch nlohmann/json
include(FetchContent)
FetchContent_Declare(
    nlohmann_json
    URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
)
FetchContent_MakeAvailable(nlohmann_json)

add_library(SankeyDecoder SHARED
    src/SankeyDecoder.cpp
    src/CSankeyLicenseDecoder.cpp
)

target_include_directories(SankeyDecoder PUBLIC
    ${PROJECT_SOURCE_DIR}/include
)

target_compile_definitions(SankeyDecoder PRIVATE SANKEYDECODER_EXPORTS)

target_link_libraries(SankeyDecoder
    Crypt32
    nlohmann_json::nlohmann_json
)

set_target_properties(SankeyDecoder PROPERTIES
    OUTPUT_NAME "SankeyDecoder"
    RUNTIME_OUTPUT_DIRECTORY_DEBUG ${CMAKE_BINARY_DIR}/bin/Debug
    RUNTIME_OUTPUT_DIRECTORY_RELEASE ${CMAKE_BINARY_DIR}/bin/Release
)

# GoogleTest setup
FetchContent_Declare(
  googletest
  URL https://github.com/google/googletest/archive/release-1.12.1.zip
)
set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(googletest)

enable_testing()

add_executable(SankeyDecoderTests
    tests/test_decrypt.cpp
    tests/test_license_decoder.cpp
)

target_link_libraries(SankeyDecoderTests
    GTest::gtest_main
    SankeyDecoder
)

add_custom_command(TARGET SankeyDecoderTests POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
    $<TARGET_FILE:SankeyDecoder>
    $<TARGET_FILE_DIR:SankeyDecoderTests>
)

include(GoogleTest)
gtest_discover_tests(SankeyDecoderTests)